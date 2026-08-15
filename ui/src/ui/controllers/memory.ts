import type { GatewayBrowserClient } from "../gateway.ts";

export interface MemoryEntry {
  name: string;
  description: string;
  file?: string;
}

export interface MemoryGraphNode {
  name: string;
  path: string;
  description?: string;
  type?: string;
  size: number;
  mtimeMs: number;
}

export type MemoryGraphEdgeType = "wikilink" | "similarity" | "tag";

export interface MemoryGraphEdge {
  source: string;
  target: string;
  type: MemoryGraphEdgeType;
  weight: number;
}

export interface MemoryGraph {
  nodes: MemoryGraphNode[];
  edges: MemoryGraphEdge[];
  generatedAtMs: number;
}

const INDEX_LINE = /^\s*[-*]\s*\[([^\]]+)\]\(([^)]+)\)\s*(?:[—–-]\s*(.*))?$/;
export const MEMORY_REQUEST_TIMEOUT_MS = 15_000;

/** Parse a `MEMORY.md` index body into entries. Lines look like:
 *  `- [Title](file.md) — short hook` */
export function parseMemoryIndex(content: string): MemoryEntry[] {
  const entries: MemoryEntry[] = [];
  for (const raw of content.split("\n")) {
    const m = INDEX_LINE.exec(raw);
    if (!m) {
      continue;
    }
    const [, title, file, hook] = m;
    entries.push({ name: title.trim(), file: file.trim(), description: (hook ?? "").trim() });
  }
  return entries;
}

/** Load the memory index for an agent by reading its `MEMORY.md` workspace file. */
export async function loadMemoryIndex(
  client: GatewayBrowserClient,
  agentId: string,
): Promise<MemoryEntry[]> {
  const res = await client.request<{ file?: { content?: string } } | null>(
    "agents.files.get",
    {
      agentId,
      name: "MEMORY.md",
    },
    { timeoutMs: MEMORY_REQUEST_TIMEOUT_MS },
  );
  const content = res?.file?.content ?? "";
  return parseMemoryIndex(content);
}

/** Load the force-graph of an agent's memory via the `agents.memory.graph` RPC. */
export async function loadMemoryGraph(
  client: GatewayBrowserClient,
  agentId: string,
): Promise<MemoryGraph> {
  const res = await client.request<MemoryGraph | null>(
    "agents.memory.graph",
    { agentId },
    { timeoutMs: MEMORY_REQUEST_TIMEOUT_MS },
  );
  return {
    nodes: res?.nodes ?? [],
    edges: res?.edges ?? [],
    generatedAtMs: res?.generatedAtMs ?? 0,
  };
}
