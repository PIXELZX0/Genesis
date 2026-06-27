import { formatErrorMessage } from "genesis/plugin-sdk/error-runtime";
import type { MemorySource } from "genesis/plugin-sdk/memory-core-host-engine-storage";
import {
  asToolParamsRecord,
  jsonResult,
  readNumberParam,
  readStringParam,
  type GenesisConfig,
} from "genesis/plugin-sdk/memory-core-host-runtime-core";
import type {
  MemorySearchResult,
  MemorySearchRuntimeDebug,
} from "genesis/plugin-sdk/memory-core-host-runtime-files";
import {
  resolveMemoryCorePluginConfig,
  resolveMemoryDeepDreamingConfig,
} from "genesis/plugin-sdk/memory-core-host-status";
import { filterMemorySearchHitsBySessionVisibility } from "./session-search-visibility.js";
import { recordShortTermRecalls } from "./short-term-promotion.js";
import {
  clampResultsByInjectedChars,
  decorateCitations,
  resolveMemoryCitationsMode,
  shouldIncludeCitations,
} from "./tools.citations.js";
import {
  buildMemorySearchUnavailableResult,
  createMemoryTool,
  getMemoryCorpusSupplementResult,
  getMemoryManagerContext,
  getMemoryManagerContextWithPurpose,
  loadMemoryToolRuntime,
  MemoryGetSchema,
  MemorySearchSchema,
  MemorySuggestLinksSchema,
  searchMemoryCorpusSupplements,
} from "./tools.shared.js";

function buildRecallKey(
  result: Pick<MemorySearchResult, "source" | "path" | "startLine" | "endLine">,
): string {
  return `${result.source}:${result.path}:${result.startLine}:${result.endLine}`;
}

function resolveRecallTrackingResults(
  rawResults: MemorySearchResult[],
  surfacedResults: MemorySearchResult[],
): MemorySearchResult[] {
  if (surfacedResults.length === 0 || rawResults.length === 0) {
    return surfacedResults;
  }
  const rawByKey = new Map<string, MemorySearchResult>();
  for (const raw of rawResults) {
    const key = buildRecallKey(raw);
    if (!rawByKey.has(key)) {
      rawByKey.set(key, raw);
    }
  }
  return surfacedResults.map((surfaced) => rawByKey.get(buildRecallKey(surfaced)) ?? surfaced);
}

function queueShortTermRecallTracking(params: {
  workspaceDir?: string;
  query: string;
  rawResults: MemorySearchResult[];
  surfacedResults: MemorySearchResult[];
  timezone?: string;
}): void {
  const trackingResults = resolveRecallTrackingResults(params.rawResults, params.surfacedResults);
  void recordShortTermRecalls({
    workspaceDir: params.workspaceDir,
    query: params.query,
    results: trackingResults,
    timezone: params.timezone,
  }).catch(() => {
    // Recall tracking is best-effort and must never block memory recall.
  });
}

function normalizeActiveMemoryQmdSearchMode(
  value: unknown,
): "inherit" | "search" | "vsearch" | "query" {
  return value === "inherit" || value === "search" || value === "vsearch" || value === "query"
    ? value
    : "search";
}

function isActiveMemorySessionKey(sessionKey?: string): boolean {
  return typeof sessionKey === "string" && sessionKey.includes(":active-memory:");
}

function resolveActiveMemoryQmdSearchModeOverride(
  cfg: GenesisConfig,
  sessionKey?: string,
): "search" | "vsearch" | "query" | undefined {
  if (!isActiveMemorySessionKey(sessionKey)) {
    return undefined;
  }
  const entry = cfg.plugins?.entries?.["active-memory"];
  const entryRecord =
    entry && typeof entry === "object" && !Array.isArray(entry)
      ? (entry as { config?: unknown })
      : undefined;
  const pluginConfig =
    entryRecord?.config &&
    typeof entryRecord.config === "object" &&
    !Array.isArray(entryRecord.config)
      ? (entryRecord.config as { qmd?: { searchMode?: unknown } })
      : undefined;
  const searchMode = normalizeActiveMemoryQmdSearchMode(pluginConfig?.qmd?.searchMode);
  return searchMode === "inherit" ? undefined : searchMode;
}

async function getSupplementMemoryReadResult(params: {
  relPath: string;
  from?: number;
  lines?: number;
  agentSessionKey?: string;
  corpus?: "memory" | "wiki" | "all";
}) {
  const supplement = await getMemoryCorpusSupplementResult({
    lookup: params.relPath,
    fromLine: params.from,
    lineCount: params.lines,
    agentSessionKey: params.agentSessionKey,
    corpus: params.corpus,
  });
  if (!supplement) {
    return null;
  }
  const { content, ...rest } = supplement;
  return {
    ...rest,
    text: content,
  };
}

async function resolveMemoryReadFailureResult(params: {
  error: unknown;
  requestedCorpus?: "memory" | "wiki" | "all";
  relPath: string;
  from?: number;
  lines?: number;
  agentSessionKey?: string;
}) {
  if (params.requestedCorpus === "all") {
    const supplement = await getSupplementMemoryReadResult({
      relPath: params.relPath,
      from: params.from,
      lines: params.lines,
      agentSessionKey: params.agentSessionKey,
      corpus: params.requestedCorpus,
    });
    if (supplement) {
      return jsonResult(supplement);
    }
  }
  const message = formatErrorMessage(params.error);
  return jsonResult({ path: params.relPath, text: "", disabled: true, error: message });
}

async function executeMemoryReadResult<T>(params: {
  read: () => Promise<T>;
  requestedCorpus?: "memory" | "wiki" | "all";
  relPath: string;
  from?: number;
  lines?: number;
  agentSessionKey?: string;
}) {
  try {
    return jsonResult(await params.read());
  } catch (error) {
    return await resolveMemoryReadFailureResult({
      error,
      requestedCorpus: params.requestedCorpus,
      relPath: params.relPath,
      from: params.from,
      lines: params.lines,
      agentSessionKey: params.agentSessionKey,
    });
  }
}

export function createMemorySearchTool(options: {
  config?: GenesisConfig;
  agentSessionKey?: string;
  sandboxed?: boolean;
}) {
  return createMemoryTool({
    options,
    label: "Memory Search",
    name: "memory_search",
    description:
      "Mandatory recall step: semantically search MEMORY.md + memory/*.md (and optional session transcripts) before answering questions about prior work, decisions, dates, people, preferences, or todos. Optional `corpus=wiki` or `corpus=all` also searches registered compiled-wiki supplements. `corpus=memory` restricts hits to indexed memory files (excludes session transcript chunks from ranking). `corpus=sessions` restricts hits to indexed session transcripts (same visibility rules as session history tools). If response has disabled=true, memory retrieval is unavailable and should be surfaced to the user.",
    parameters: MemorySearchSchema,
    execute:
      ({ cfg, agentId }) =>
      async (_toolCallId, params) => {
        const rawParams = asToolParamsRecord(params);
        const query = readStringParam(rawParams, "query", { required: true });
        const maxResults = readNumberParam(rawParams, "maxResults");
        const minScore = readNumberParam(rawParams, "minScore");
        const requestedCorpus = readStringParam(rawParams, "corpus") as
          | "memory"
          | "wiki"
          | "all"
          | "sessions"
          | undefined;
        const { resolveMemoryBackendConfig } = await loadMemoryToolRuntime();
        const shouldQueryMemory = requestedCorpus !== "wiki";
        const shouldQuerySupplements = requestedCorpus === "wiki" || requestedCorpus === "all";
        const memory = shouldQueryMemory ? await getMemoryManagerContext({ cfg, agentId }) : null;
        if (shouldQueryMemory && memory && "error" in memory && !shouldQuerySupplements) {
          return jsonResult(buildMemorySearchUnavailableResult(memory.error));
        }
        try {
          const citationsMode = resolveMemoryCitationsMode(cfg);
          const includeCitations = shouldIncludeCitations({
            mode: citationsMode,
            sessionKey: options.agentSessionKey,
          });
          const searchStartedAt = Date.now();
          let rawResults: MemorySearchResult[] = [];
          let surfacedMemoryResults: Array<
            Record<string, unknown> & { corpus: "memory"; score: number; path: string }
          > = [];
          let provider: string | undefined;
          let model: string | undefined;
          let fallback: unknown;
          let searchMode: string | undefined;
          let searchDebug:
            | {
                backend: string;
                configuredMode?: string;
                effectiveMode?: string;
                fallback?: string;
                searchMs: number;
                hits: number;
              }
            | undefined;
          if (shouldQueryMemory && memory && !("error" in memory)) {
            const runtimeDebug: MemorySearchRuntimeDebug[] = [];
            const qmdSearchModeOverride = resolveActiveMemoryQmdSearchModeOverride(
              cfg,
              options.agentSessionKey,
            );
            const searchSources: MemorySource[] | undefined =
              requestedCorpus === "sessions"
                ? (["sessions"] as MemorySource[])
                : requestedCorpus === "memory"
                  ? (["memory"] as MemorySource[])
                  : undefined;
            rawResults = await memory.manager.search(query, {
              maxResults,
              minScore,
              sessionKey: options.agentSessionKey,
              qmdSearchModeOverride,
              onDebug: (debug) => {
                runtimeDebug.push(debug);
              },
              ...(searchSources ? { sources: searchSources } : {}),
            });
            rawResults = await filterMemorySearchHitsBySessionVisibility({
              cfg,
              requesterSessionKey: options.agentSessionKey,
              sandboxed: options.sandboxed === true,
              hits: rawResults,
            });
            if (requestedCorpus === "sessions") {
              rawResults = rawResults.filter((hit) => hit.source === "sessions");
            } else if (requestedCorpus === "memory") {
              rawResults = rawResults.filter((hit) => hit.source === "memory");
            }
            const status = memory.manager.status();
            const decorated = decorateCitations(rawResults, includeCitations);
            const resolved = resolveMemoryBackendConfig({ cfg, agentId });
            const memoryResults =
              status.backend === "qmd"
                ? clampResultsByInjectedChars(decorated, resolved.qmd?.limits.maxInjectedChars)
                : decorated;
            surfacedMemoryResults = memoryResults.map((result) => ({
              ...result,
              corpus: "memory" as const,
            }));
            const sleepTimezone = resolveMemoryDeepDreamingConfig({
              pluginConfig: resolveMemoryCorePluginConfig(cfg),
              cfg,
            }).timezone;
            queueShortTermRecallTracking({
              workspaceDir: status.workspaceDir,
              query,
              rawResults,
              surfacedResults: memoryResults,
              timezone: sleepTimezone,
            });
            provider = status.provider;
            model = status.model;
            fallback = status.fallback;
            const latestDebug = runtimeDebug.at(-1);
            searchMode = latestDebug?.effectiveMode;
            searchDebug = {
              backend: status.backend,
              configuredMode: latestDebug?.configuredMode,
              effectiveMode:
                status.backend === "qmd"
                  ? (latestDebug?.effectiveMode ?? latestDebug?.configuredMode)
                  : "n/a",
              fallback: latestDebug?.fallback,
              searchMs: Math.max(0, Date.now() - searchStartedAt),
              hits: rawResults.length,
            };
          }
          const supplementResults = shouldQuerySupplements
            ? await searchMemoryCorpusSupplements({
                query,
                maxResults,
                agentSessionKey: options.agentSessionKey,
                corpus: requestedCorpus,
              })
            : [];
          const results = [...surfacedMemoryResults, ...supplementResults]
            .toSorted((left, right) => {
              if (left.score !== right.score) {
                return right.score - left.score;
              }
              return left.path.localeCompare(right.path);
            })
            .slice(0, Math.max(1, maxResults ?? 10));
          return jsonResult({
            results,
            provider,
            model,
            fallback,
            citations: citationsMode,
            mode: searchMode,
            debug: searchDebug,
          });
        } catch (err) {
          const message = formatErrorMessage(err);
          return jsonResult(buildMemorySearchUnavailableResult(message));
        }
      },
  });
}

export function createMemoryGetTool(options: { config?: GenesisConfig; agentSessionKey?: string }) {
  return createMemoryTool({
    options,
    label: "Memory Get",
    name: "memory_get",
    description:
      "Safe exact excerpt read from MEMORY.md or memory/*.md. Defaults to a bounded excerpt when lines are omitted, includes truncation/continuation info when more content exists, and `corpus=wiki` reads from registered compiled-wiki supplements.",
    parameters: MemoryGetSchema,
    execute:
      ({ cfg, agentId }) =>
      async (_toolCallId, params) => {
        const rawParams = asToolParamsRecord(params);
        const relPath = readStringParam(rawParams, "path", { required: true });
        const from = readNumberParam(rawParams, "from", { integer: true });
        const lines = readNumberParam(rawParams, "lines", { integer: true });
        const requestedCorpus = readStringParam(rawParams, "corpus") as
          | "memory"
          | "wiki"
          | "all"
          | undefined;
        const { readAgentMemoryFile, resolveMemoryBackendConfig } = await loadMemoryToolRuntime();
        if (requestedCorpus === "wiki") {
          const supplement = await getSupplementMemoryReadResult({
            relPath,
            from: from ?? undefined,
            lines: lines ?? undefined,
            agentSessionKey: options.agentSessionKey,
            corpus: requestedCorpus,
          });
          return jsonResult(
            supplement ?? {
              path: relPath,
              text: "",
              disabled: true,
              error: "wiki corpus result not found",
            },
          );
        }
        const resolved = resolveMemoryBackendConfig({ cfg, agentId });
        if (resolved.backend === "builtin") {
          return await executeMemoryReadResult({
            read: async () =>
              await readAgentMemoryFile({
                cfg,
                agentId,
                relPath,
                from: from ?? undefined,
                lines: lines ?? undefined,
              }),
            requestedCorpus,
            relPath,
            from: from ?? undefined,
            lines: lines ?? undefined,
            agentSessionKey: options.agentSessionKey,
          });
        }
        const memory = await getMemoryManagerContextWithPurpose({
          cfg,
          agentId,
          purpose: "status",
        });
        if ("error" in memory) {
          return jsonResult({ path: relPath, text: "", disabled: true, error: memory.error });
        }
        return await executeMemoryReadResult({
          read: async () =>
            await memory.manager.readFile({
              relPath,
              from: from ?? undefined,
              lines: lines ?? undefined,
            }),
          requestedCorpus,
          relPath,
          from: from ?? undefined,
          lines: lines ?? undefined,
          agentSessionKey: options.agentSessionKey,
        });
      },
  });
}

export function createMemorySuggestLinksTool(options: {
  config?: GenesisConfig;
  agentSessionKey?: string;
}) {
  return createMemoryTool({
    options,
    label: "Memory Suggest Links",
    name: "memory_suggest_links",
    description:
      "Surfaces semantically-related memory files that are not yet wiki-linked. Compares similarity edges from the memory graph against existing [[wikilink]] edges and returns unlinked pairs ranked by semantic score. The agent or user can add the suggested [[links]] manually — this tool is read-only and never writes files.",
    parameters: MemorySuggestLinksSchema,
    execute:
      ({ cfg, agentId }) =>
      async (_toolCallId, params) => {
        const rawParams = asToolParamsRecord(params);
        const name = readStringParam(rawParams, "name");
        const maxResults = readNumberParam(rawParams, "maxResults") ?? 20;
        const minScore = readNumberParam(rawParams, "minScore") ?? 0;

        const memory = await getMemoryManagerContext({ cfg, agentId });
        if ("error" in memory) {
          return jsonResult({
            ...buildMemorySearchUnavailableResult(memory.error),
            suggestions: [],
          });
        }

        if (typeof memory.manager.graph !== "function") {
          return jsonResult({ disabled: true, reason: "graph unavailable", suggestions: [] });
        }

        const graph = await memory.manager.graph({ agentId });

        // Build set of existing wikilink unordered pairs.
        const linkedPairs = new Set<string>();
        for (const edge of graph.edges) {
          if (edge.type === "wikilink") {
            const lo = edge.source < edge.target ? edge.source : edge.target;
            const hi = edge.source < edge.target ? edge.target : edge.source;
            linkedPairs.add(`${lo}|${hi}`);
          }
        }

        // Build a lookup from path to node for name/description access.
        const nodeByPath = new Map<string, { name: string; path: string }>();
        for (const node of graph.nodes) {
          nodeByPath.set(node.path, node);
        }

        // Candidate suggestions: similarity edges whose unordered pair is NOT already wikilinked.
        const candidates = graph.edges.filter((edge) => {
          if (edge.type !== "similarity") {
            return false;
          }
          const lo = edge.source < edge.target ? edge.source : edge.target;
          const hi = edge.source < edge.target ? edge.target : edge.source;
          return !linkedPairs.has(`${lo}|${hi}`);
        });

        // If `name` param given, keep only candidates where one endpoint matches.
        const normalizedName = name ? name.toLowerCase() : null;
        const filtered = normalizedName
          ? candidates.filter((edge) => {
              const srcNode = nodeByPath.get(edge.source);
              const tgtNode = nodeByPath.get(edge.target);
              const srcStem =
                edge.source
                  .replace(/\.[^/.]+$/, "")
                  .split("/")
                  .at(-1) ?? "";
              const tgtStem =
                edge.target
                  .replace(/\.[^/.]+$/, "")
                  .split("/")
                  .at(-1) ?? "";
              return (
                srcNode?.name.toLowerCase() === normalizedName ||
                tgtNode?.name.toLowerCase() === normalizedName ||
                srcStem.toLowerCase() === normalizedName ||
                tgtStem.toLowerCase() === normalizedName
              );
            })
          : candidates;

        // Sort by score descending, apply minScore, slice to maxResults.
        const suggestions = filtered
          .toSorted((a, b) => b.weight - a.weight)
          .filter((edge) => edge.weight >= minScore)
          .slice(0, Math.max(1, maxResults))
          .map((edge) => {
            const srcNode = nodeByPath.get(edge.source);
            const tgtNode = nodeByPath.get(edge.target);
            const fromPath = edge.source;
            const toPath = edge.target;
            const fromName = srcNode?.name ?? fromPath;
            const toName = tgtNode?.name ?? toPath;

            // If name filter was provided, orient `from` = the matched node.
            let orientedFrom = fromPath;
            let orientedTo = toPath;
            let orientedFromName = fromName;
            let orientedToName = toName;
            if (normalizedName) {
              const srcStem =
                edge.source
                  .replace(/\.[^/.]+$/, "")
                  .split("/")
                  .at(-1) ?? "";
              const srcMatches =
                srcNode?.name.toLowerCase() === normalizedName ||
                srcStem.toLowerCase() === normalizedName;
              if (!srcMatches) {
                orientedFrom = toPath;
                orientedTo = fromPath;
                orientedFromName = toName;
                orientedToName = fromName;
              }
            }

            return {
              from: orientedFrom,
              to: orientedTo,
              fromName: orientedFromName,
              toName: orientedToName,
              score: edge.weight,
              suggestedLink: `[[${orientedToName}]]`,
            };
          });

        const readyToPaste =
          suggestions.length > 0
            ? `## Related (suggested)\n${suggestions.map((s) => `- [[${s.toName}]]`).join("\n")}\n`
            : undefined;

        return jsonResult({
          disabled: false,
          count: suggestions.length,
          suggestions,
          generatedAtMs: graph.generatedAtMs,
          ...(readyToPaste !== undefined ? { readyToPaste } : {}),
        });
      },
  });
}
