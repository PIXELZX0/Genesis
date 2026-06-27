import type { Dirent } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import {
  cosineSimilarity,
  parseEmbedding,
  type MemoryGraphEdge,
  type MemoryGraphNode,
  type MemoryGraphResult,
} from "genesis/plugin-sdk/memory-core-host-engine-storage";
import { deriveConceptTags } from "../concept-vocabulary.js";

const ROOT_MEMORY_FILENAME = "MEMORY.md";
const MEMORY_SUBDIR = "memory";
const DEFAULT_SIMILARITY_THRESHOLD = 0.82;
const DEFAULT_SIMILARITY_TOP_K = 4;
const DEFAULT_TAG_TOP_K = 4;
const TAG_SNIPPET_MAX_CHARS = 2000;
const WIKILINK_RE = /\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g;

/**
 * Loose provider shape: the graph builder only needs to know whether an
 * embedding provider is present (non-null) to decide if similarity edges can be
 * computed. It never invokes the provider.
 */
export type MemoryGraphProvider = unknown;

export type BuildMemoryGraphDeps = {
  db: DatabaseSync;
  workspaceDir: string;
  provider: MemoryGraphProvider;
  similarityThreshold?: number;
  similarityTopK?: number;
  tagTopK?: number;
  /** Optional warning sink (defaults to a no-op). */
  warn?: (message: string) => void;
};

type FrontmatterParseResult = {
  name?: string;
  description?: string;
  type?: string;
};

type GraphNodeInternal = MemoryGraphNode & {
  body: string;
};

type FileStatRow = { mtime: number; size: number };

/**
 * Minimal frontmatter parser scoped to the memory-graph use case. Parses a
 * leading `--- ... ---` block of `key: value` lines plus a nested
 * `metadata:` block where `type:` (indented) maps to the node type. Avoids a
 * YAML dependency and the core-only frontmatter parser (which is not reachable
 * across the extension boundary).
 */
export function parseGraphFrontmatter(content: string): FrontmatterParseResult {
  const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (!normalized.startsWith("---\n") && normalized !== "---") {
    return {};
  }
  const endIndex = normalized.indexOf("\n---", 3);
  if (endIndex === -1) {
    return {};
  }
  const block = normalized.slice(4, endIndex);
  const lines = block.split("\n");

  const result: FrontmatterParseResult = {};
  let inMetadata = false;

  for (const rawLine of lines) {
    if (rawLine.trim().length === 0) {
      continue;
    }
    const indented = /^\s+/.test(rawLine);
    const trimmed = rawLine.trim();
    const colonIndex = trimmed.indexOf(":");
    if (colonIndex === -1) {
      continue;
    }
    const key = trimmed.slice(0, colonIndex).trim();
    const value = stripScalarQuotes(trimmed.slice(colonIndex + 1).trim());

    if (!indented) {
      // Top-level key resets metadata scope.
      if (key === "metadata") {
        inMetadata = value.length === 0;
        continue;
      }
      inMetadata = false;
      if (key === "name" && value.length > 0) {
        result.name = value;
      } else if (key === "description" && value.length > 0) {
        result.description = value;
      } else if (key === "type" && value.length > 0) {
        result.type = value;
      }
      continue;
    }

    // Indented line: only meaningful inside a `metadata:` block.
    if (inMetadata && key === "type" && value.length > 0) {
      result.type = value;
    }
  }

  return result;
}

function stripScalarQuotes(value: string): string {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1);
    }
  }
  return value;
}

function normalizeRelativePath(value: string): string {
  return value.trim().replace(/\\/g, "/").replace(/^\.\//, "");
}

function filenameStem(relPath: string): string {
  return path.basename(relPath).replace(/\.[^.]+$/, "");
}

function stripFrontmatterForBody(content: string): string {
  const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (!normalized.startsWith("---\n") && normalized !== "---") {
    return normalized;
  }
  const endIndex = normalized.indexOf("\n---", 3);
  if (endIndex === -1) {
    return normalized;
  }
  // Skip past the closing fence and one trailing newline if present.
  const afterFence = normalized.slice(endIndex + 4);
  return afterFence.startsWith("\n") ? afterFence.slice(1) : afterFence;
}

async function listMemoryMarkdownFiles(workspaceDir: string): Promise<string[]> {
  const results: string[] = [];

  const rootFile = path.join(workspaceDir, ROOT_MEMORY_FILENAME);
  if (await isReadableFile(rootFile)) {
    results.push(ROOT_MEMORY_FILENAME);
  }

  const memoryDir = path.join(workspaceDir, MEMORY_SUBDIR);
  await walkMarkdown(memoryDir, results, workspaceDir);

  return results;
}

async function walkMarkdown(
  currentDir: string,
  out: string[],
  workspaceDir: string,
): Promise<void> {
  let entries: Dirent[];
  try {
    entries = await fs.readdir(currentDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) {
      continue;
    }
    const abs = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      await walkMarkdown(abs, out, workspaceDir);
      continue;
    }
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".md")) {
      continue;
    }
    out.push(normalizeRelativePath(path.relative(workspaceDir, abs)));
  }
}

async function isReadableFile(absPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(absPath);
    return stat.isFile();
  } catch {
    return false;
  }
}

function readFileStatsFromDb(db: DatabaseSync): Map<string, FileStatRow> {
  const out = new Map<string, FileStatRow>();
  try {
    const rows = db
      .prepare(`SELECT path, mtime, size FROM files WHERE source = 'memory'`)
      .all() as Array<{ path: string; mtime: number; size: number }>;
    for (const row of rows) {
      out.set(normalizeRelativePath(row.path), { mtime: row.mtime, size: row.size });
    }
  } catch {
    // files table may be absent in degraded scenarios; fall back to fs.stat.
  }
  return out;
}

async function buildNodes(deps: BuildMemoryGraphDeps): Promise<GraphNodeInternal[]> {
  const relPaths = await listMemoryMarkdownFiles(deps.workspaceDir);
  const dbStats = readFileStatsFromDb(deps.db);
  const nodes: GraphNodeInternal[] = [];

  for (const relPath of relPaths) {
    const absPath = path.join(deps.workspaceDir, relPath);
    let content: string;
    try {
      content = await fs.readFile(absPath, "utf8");
    } catch {
      deps.warn?.(`memory graph: failed to read ${relPath}`);
      continue;
    }

    const frontmatter = parseGraphFrontmatter(content);
    const body = stripFrontmatterForBody(content);

    let size: number;
    let mtimeMs: number;
    const dbStat = dbStats.get(relPath);
    if (dbStat) {
      size = dbStat.size;
      mtimeMs = dbStat.mtime;
    } else {
      try {
        const stat = await fs.stat(absPath);
        size = stat.size;
        mtimeMs = stat.mtimeMs;
      } catch {
        size = Buffer.byteLength(content, "utf8");
        mtimeMs = Date.now();
      }
    }

    const node: GraphNodeInternal = {
      name: frontmatter.name ?? filenameStem(relPath),
      path: relPath,
      size,
      mtimeMs,
      body,
    };
    if (frontmatter.description) {
      node.description = frontmatter.description;
    }
    if (frontmatter.type) {
      node.type = frontmatter.type;
    }
    nodes.push(node);
  }

  return nodes;
}

function buildWikilinkEdges(nodes: GraphNodeInternal[]): MemoryGraphEdge[] {
  const byName = new Map<string, string>();
  const byStem = new Map<string, string>();
  for (const node of nodes) {
    byName.set(node.name.toLowerCase(), node.path);
    byStem.set(filenameStem(node.path).toLowerCase(), node.path);
  }

  const edges: MemoryGraphEdge[] = [];
  const seen = new Set<string>();

  for (const node of nodes) {
    WIKILINK_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = WIKILINK_RE.exec(node.body)) !== null) {
      const targetText = (match[1] ?? "").trim();
      if (targetText.length === 0) {
        continue;
      }
      const key = targetText.toLowerCase();
      const targetPath = byName.get(key) ?? byStem.get(key);
      if (!targetPath || targetPath === node.path) {
        continue;
      }
      const dedupKey = `${node.path} ${targetPath}`;
      if (seen.has(dedupKey)) {
        continue;
      }
      seen.add(dedupKey);
      edges.push({ source: node.path, target: targetPath, type: "wikilink", weight: 1 });
    }
  }

  return edges;
}

function meanUnitVector(vectors: number[][]): number[] | null {
  if (vectors.length === 0) {
    return null;
  }
  let dims = 0;
  for (const vec of vectors) {
    dims = Math.max(dims, vec.length);
  }
  if (dims === 0) {
    return null;
  }
  const sum = Array.from<number>({ length: dims }).fill(0);
  for (const vec of vectors) {
    for (let i = 0; i < dims; i += 1) {
      sum[i] = (sum[i] ?? 0) + (vec[i] ?? 0);
    }
  }
  const mean = sum.map((v) => v / vectors.length);
  let norm = 0;
  for (const v of mean) {
    norm += v * v;
  }
  norm = Math.sqrt(norm);
  if (norm === 0) {
    return null;
  }
  return mean.map((v) => v / norm);
}

function buildSimilarityEdges(
  deps: BuildMemoryGraphDeps,
  nodes: GraphNodeInternal[],
): MemoryGraphEdge[] {
  if (!deps.provider) {
    return [];
  }
  const threshold = deps.similarityThreshold ?? DEFAULT_SIMILARITY_THRESHOLD;
  const topK = deps.similarityTopK ?? DEFAULT_SIMILARITY_TOP_K;
  const nodePaths = new Set(nodes.map((node) => node.path));

  const grouped = new Map<string, number[][]>();
  try {
    const rows = deps.db
      .prepare(`SELECT path, embedding FROM chunks WHERE source = 'memory'`)
      .all() as Array<{ path: string; embedding: string }>;
    for (const row of rows) {
      const relPath = normalizeRelativePath(row.path);
      if (!nodePaths.has(relPath)) {
        continue;
      }
      const vec = parseEmbedding(row.embedding);
      if (vec.length === 0) {
        continue;
      }
      const list = grouped.get(relPath);
      if (list) {
        list.push(vec);
      } else {
        grouped.set(relPath, [vec]);
      }
    }
  } catch {
    deps.warn?.("memory graph: failed to read chunk embeddings; skipping similarity edges");
    return [];
  }

  const fileVectors = new Map<string, number[]>();
  for (const [relPath, vectors] of grouped) {
    const mean = meanUnitVector(vectors);
    if (mean) {
      fileVectors.set(relPath, mean);
    }
  }

  const paths = [...fileVectors.keys()].toSorted((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  // candidate edges per node, capped to top-K by weight per node.
  const perNode = new Map<string, Array<{ other: string; weight: number }>>();
  for (let i = 0; i < paths.length; i += 1) {
    for (let j = i + 1; j < paths.length; j += 1) {
      const a = paths[i];
      const b = paths[j];
      const cosine = cosineSimilarity(
        fileVectors.get(a) as number[],
        fileVectors.get(b) as number[],
      );
      if (cosine < threshold) {
        continue;
      }
      pushCandidate(perNode, a, { other: b, weight: cosine });
      pushCandidate(perNode, b, { other: a, weight: cosine });
    }
  }

  const edges: MemoryGraphEdge[] = [];
  const seen = new Set<string>();
  for (const [node, candidates] of perNode) {
    const kept = candidates.toSorted((x, y) => y.weight - x.weight).slice(0, topK);
    for (const candidate of kept) {
      const [source, target] =
        node < candidate.other ? [node, candidate.other] : [candidate.other, node];
      const dedupKey = `${source} ${target}`;
      if (seen.has(dedupKey)) {
        continue;
      }
      seen.add(dedupKey);
      edges.push({ source, target, type: "similarity", weight: candidate.weight });
    }
  }

  return edges;
}

function pushCandidate(
  perNode: Map<string, Array<{ other: string; weight: number }>>,
  node: string,
  candidate: { other: string; weight: number },
): void {
  const list = perNode.get(node);
  if (list) {
    list.push(candidate);
  } else {
    perNode.set(node, [candidate]);
  }
}

function buildTagEdges(nodes: GraphNodeInternal[], tagTopK: number): MemoryGraphEdge[] {
  const tagsByPath = new Map<string, Set<string>>();
  for (const node of nodes) {
    const snippet = node.body.slice(0, TAG_SNIPPET_MAX_CHARS);
    const tags = deriveConceptTags({ path: node.path, snippet });
    tagsByPath.set(node.path, new Set(tags));
  }

  const paths = nodes.map((node) => node.path);
  const perNode = new Map<string, Array<{ other: string; weight: number }>>();
  for (let i = 0; i < paths.length; i += 1) {
    for (let j = i + 1; j < paths.length; j += 1) {
      const a = paths[i];
      const b = paths[j];
      const tagsA = tagsByPath.get(a);
      const tagsB = tagsByPath.get(b);
      if (!tagsA || !tagsB) {
        continue;
      }
      let shared = 0;
      for (const tag of tagsA) {
        if (tagsB.has(tag)) {
          shared += 1;
        }
      }
      if (shared < 1) {
        continue;
      }
      pushCandidate(perNode, a, { other: b, weight: shared });
      pushCandidate(perNode, b, { other: a, weight: shared });
    }
  }

  const edges: MemoryGraphEdge[] = [];
  const seen = new Set<string>();
  for (const [node, candidates] of perNode) {
    const kept = candidates.toSorted((x, y) => y.weight - x.weight).slice(0, tagTopK);
    for (const candidate of kept) {
      const [source, target] =
        node < candidate.other ? [node, candidate.other] : [candidate.other, node];
      const dedupKey = `${source} ${target}`;
      if (seen.has(dedupKey)) {
        continue;
      }
      seen.add(dedupKey);
      edges.push({ source, target, type: "tag", weight: candidate.weight });
    }
  }

  return edges;
}

/**
 * Build a memory graph for a single agent's memory workspace: nodes are memory
 * markdown files, edges are wikilink / similarity / tag relationships. Pure and
 * self-contained: all I/O is driven by the injected `db` + `workspaceDir`.
 */
export async function buildMemoryGraph(deps: BuildMemoryGraphDeps): Promise<MemoryGraphResult> {
  const internalNodes = await buildNodes(deps);
  const tagTopK = deps.tagTopK ?? DEFAULT_TAG_TOP_K;

  const wikilinkEdges = buildWikilinkEdges(internalNodes);
  const similarityEdges = buildSimilarityEdges(deps, internalNodes);
  const tagEdges = buildTagEdges(internalNodes, tagTopK);

  const nodes: MemoryGraphNode[] = internalNodes.map(({ body: _body, ...node }) => node);

  return {
    nodes,
    edges: [...wikilinkEdges, ...similarityEdges, ...tagEdges],
    generatedAtMs: Date.now(),
  };
}
