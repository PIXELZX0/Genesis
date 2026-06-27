import { describe, expect, it, vi } from "vitest";
import type { GatewayBrowserClient } from "../gateway.ts";
import { loadMemoryGraph, parseMemoryIndex } from "./memory.ts";

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

describe("loadMemoryGraph", () => {
  it("returns the graph from the RPC", async () => {
    const request = vi.fn(async () => ({
      nodes: [{ name: "A", path: "a.md", size: 10, mtimeMs: 1 }],
      edges: [{ source: "a.md", target: "b.md", type: "wikilink", weight: 1 }],
      generatedAtMs: 42,
    }));
    const graph = await loadMemoryGraph(clientWith(request), "main");
    expect(request).toHaveBeenCalledWith("agents.memory.graph", { agentId: "main" });
    expect(graph.nodes).toHaveLength(1);
    expect(graph.edges[0]?.type).toBe("wikilink");
    expect(graph.generatedAtMs).toBe(42);
  });

  it("returns an empty graph when the RPC rejects", async () => {
    const request = vi.fn(async () => {
      throw new Error("boom");
    });
    const graph = await loadMemoryGraph(clientWith(request), "main");
    expect(graph).toEqual({ nodes: [], edges: [], generatedAtMs: 0 });
  });

  it("defaults missing fields", async () => {
    const request = vi.fn(async () => null);
    const graph = await loadMemoryGraph(clientWith(request), "main");
    expect(graph).toEqual({ nodes: [], edges: [], generatedAtMs: 0 });
  });
});
