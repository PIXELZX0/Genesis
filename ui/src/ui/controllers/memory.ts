import type { GatewayBrowserClient } from "../gateway.ts";

export interface MemoryEntry {
  name: string;
  description: string;
  file?: string;
}

const INDEX_LINE = /^\s*[-*]\s*\[([^\]]+)\]\(([^)]+)\)\s*(?:[—–-]\s*(.*))?$/;

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
  try {
    const res = await client.request<{ file?: { content?: string } } | null>("agents.files.get", {
      agentId,
      name: "MEMORY.md",
    });
    const content = res?.file?.content ?? "";
    return parseMemoryIndex(content);
  } catch {
    return [];
  }
}
