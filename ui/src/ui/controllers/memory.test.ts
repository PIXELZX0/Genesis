import { describe, expect, it, vi } from "vitest";
import type { GatewayBrowserClient } from "../gateway.ts";
import {
  loadMemoryGraph,
  loadMemoryIndex,
  MEMORY_REQUEST_TIMEOUT_MS,
  parseMemoryIndex,
} from "./memory.ts";

type RequestFn = (method: string, params?: unknown) => Promise<unknown>;

function clientWith(request: RequestFn): GatewayBrowserClient {
  return { request } as unknown as GatewayBrowserClient;
}

describe("parseMemoryIndex", () => {
  it("parses index lines into entries", () => {
    const entries = parseMemoryIndex("- [Title](file.md) — short hook\nnot a line");
    expect(entries).toEqual([{ name: "Title", file: "file.md", description: "short hook" }]);
  });
});

describe("loadMemoryIndex", () => {
  it("returns an empty result for an empty successful file", async () => {
    const request = vi.fn(async () => ({ file: { content: "" } }));

    await expect(loadMemoryIndex(clientWith(request), "main")).resolves.toEqual([]);
    expect(request).toHaveBeenCalledWith(
      "agents.files.get",
      { agentId: "main", name: "MEMORY.md" },
      { timeoutMs: MEMORY_REQUEST_TIMEOUT_MS },
    );
  });

  it("propagates file RPC errors", async () => {
    const request = vi.fn(async () => {
      throw new Error("boom");
    });

    await expect(loadMemoryIndex(clientWith(request), "main")).rejects.toThrow("boom");
  });
});

describe("loadMemoryGraph", () => {
  it("returns the graph from the RPC", async () => {
    const request = vi.fn(async () => ({
      nodes: [{ name: "A", path: "a.md", size: 10, mtimeMs: 1 }],
      edges: [{ source: "a.md", target: "b.md", type: "wikilink", weight: 1 }],
      generatedAtMs: 42,
    }));
    const graph = await loadMemoryGraph(clientWith(request), "main");
    expect(request).toHaveBeenCalledWith(
      "agents.memory.graph",
      { agentId: "main" },
      { timeoutMs: MEMORY_REQUEST_TIMEOUT_MS },
    );
    expect(graph.nodes).toHaveLength(1);
    expect(graph.edges[0]?.type).toBe("wikilink");
    expect(graph.generatedAtMs).toBe(42);
  });

  it("propagates graph RPC errors", async () => {
    const request = vi.fn(async () => {
      throw new Error("boom");
    });

    await expect(loadMemoryGraph(clientWith(request), "main")).rejects.toThrow("boom");
  });

  it("defaults missing fields", async () => {
    const request = vi.fn(async () => null);
    const graph = await loadMemoryGraph(clientWith(request), "main");
    expect(graph).toEqual({ nodes: [], edges: [], generatedAtMs: 0 });
  });
});
