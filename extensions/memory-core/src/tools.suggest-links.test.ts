import type { MemoryGraphResult } from "genesis/plugin-sdk/memory-core-host-engine-storage";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Graph mock state — mutated per-test via helpers below.
// ---------------------------------------------------------------------------

let graphResult: MemoryGraphResult = {
  nodes: [],
  edges: [],
  generatedAtMs: 1_000_000,
};
let graphImpl: (() => Promise<MemoryGraphResult>) | null = () => Promise.resolve(graphResult);

function setGraphResult(next: MemoryGraphResult): void {
  graphResult = next;
  graphImpl = () => Promise.resolve(next);
}

function setGraphUnavailable(): void {
  graphImpl = null;
}

// ---------------------------------------------------------------------------
// tools.runtime mock — must be declared before the module under test is loaded.
// ---------------------------------------------------------------------------

vi.mock("./tools.runtime.js", () => ({
  resolveMemoryBackendConfig: () => ({ backend: "builtin" as const }),
  getMemorySearchManager: vi.fn(async () => ({
    manager: {
      search: vi.fn(async () => []),
      readFile: vi.fn(async () => ({ text: "", path: "" })),
      status: () => ({
        backend: "builtin" as const,
        files: 1,
        chunks: 1,
        dirty: false,
        workspaceDir: "/workspace",
        dbPath: "/workspace/.memory/index.sqlite",
        provider: "builtin",
        model: "builtin",
        requestedProvider: "builtin",
        sources: ["memory" as const],
        sourceCounts: [{ source: "memory" as const, files: 1, chunks: 1 }],
      }),
      // graph is a function only when graphImpl is set
      get graph() {
        return graphImpl ?? undefined;
      },
      sync: vi.fn(),
      probeVectorAvailability: vi.fn(async () => true),
      probeEmbeddingAvailability: vi.fn(async () => ({ ok: true })),
      close: vi.fn(),
    },
  })),
  readAgentMemoryFile: vi.fn(async () => ({ text: "", path: "" })),
}));

// ---------------------------------------------------------------------------
// Import SUT after mock registration.
// ---------------------------------------------------------------------------

import type { GenesisConfig } from "../api.js";
import { createMemorySuggestLinksTool } from "./tools.js";

function makeConfig(): GenesisConfig {
  return { agents: { list: [{ id: "main", default: true }] } } as GenesisConfig;
}

function createToolOrThrow(config: GenesisConfig = makeConfig()) {
  const tool = createMemorySuggestLinksTool({ config });
  if (!tool) {
    throw new Error("createMemorySuggestLinksTool returned null");
  }
  return tool;
}

// ---------------------------------------------------------------------------
// A small helper graph with 4 nodes:
//   MEMORY.md  <--> memory/projects.md  (wikilink — already linked)
//   MEMORY.md  <--> memory/recipes.md   (similarity only — should surface)
//   memory/projects.md <--> memory/tasks.md  (similarity only — should surface)
//   memory/recipes.md  <--> memory/tasks.md  (similarity — but score below default threshold)
// ---------------------------------------------------------------------------

const BASE_GRAPH: MemoryGraphResult = {
  nodes: [
    { name: "Main Memory", path: "MEMORY.md", size: 100, mtimeMs: 1000 },
    { name: "Projects", path: "memory/projects.md", size: 200, mtimeMs: 1000 },
    { name: "Recipes", path: "memory/recipes.md", size: 150, mtimeMs: 1000 },
    { name: "Tasks", path: "memory/tasks.md", size: 120, mtimeMs: 1000 },
  ],
  edges: [
    // wikilink: MEMORY.md → projects.md (already linked)
    { source: "MEMORY.md", target: "memory/projects.md", type: "wikilink", weight: 1 },
    // similarity: MEMORY.md ↔ recipes.md (not yet linked, score 0.91)
    { source: "MEMORY.md", target: "memory/recipes.md", type: "similarity", weight: 0.91 },
    // similarity: projects.md ↔ tasks.md (not yet linked, score 0.88)
    { source: "memory/projects.md", target: "memory/tasks.md", type: "similarity", weight: 0.88 },
    // similarity: recipes.md ↔ tasks.md (not yet linked, score 0.83)
    { source: "memory/recipes.md", target: "memory/tasks.md", type: "similarity", weight: 0.83 },
    // similarity: MEMORY.md ↔ projects.md (same pair as wikilink — should be excluded)
    { source: "MEMORY.md", target: "memory/projects.md", type: "similarity", weight: 0.95 },
  ],
  generatedAtMs: 2_000_000,
};

describe("memory_suggest_links", () => {
  beforeEach(() => {
    setGraphResult(BASE_GRAPH);
  });

  it("excludes similarity pairs that already have a wikilink", async () => {
    const tool = createToolOrThrow();
    const result = await tool.execute("call1", {});
    const { suggestions } = result.details as {
      suggestions: Array<{ from: string; to: string }>;
      disabled?: boolean;
    };
    const pairs = suggestions.map((s) => [s.from, s.to].toSorted().join("|"));
    // MEMORY.md ↔ projects.md has wikilink — must NOT appear
    expect(pairs).not.toContain(["MEMORY.md", "memory/projects.md"].toSorted().join("|"));
  });

  it("surfaces unlinked similarity pairs", async () => {
    const tool = createToolOrThrow();
    const result = await tool.execute("call2", {});
    const { suggestions, disabled } = result.details as {
      suggestions: Array<{ from: string; to: string; score: number }>;
      disabled?: boolean;
    };
    expect(disabled).toBe(false);
    // MEMORY.md ↔ recipes.md and projects.md ↔ tasks.md should appear
    const pairs = suggestions.map((s) => [s.from, s.to].toSorted().join("|"));
    expect(pairs).toContain(["MEMORY.md", "memory/recipes.md"].toSorted().join("|"));
    expect(pairs).toContain(["memory/projects.md", "memory/tasks.md"].toSorted().join("|"));
  });

  it("sorts results by score descending", async () => {
    const tool = createToolOrThrow();
    const result = await tool.execute("call3", {});
    const { suggestions } = result.details as {
      suggestions: Array<{ score: number }>;
    };
    for (let i = 1; i < suggestions.length; i += 1) {
      expect((suggestions[i - 1] as { score: number }).score).toBeGreaterThanOrEqual(
        (suggestions[i] as { score: number }).score,
      );
    }
  });

  it("respects maxResults", async () => {
    const tool = createToolOrThrow();
    const result = await tool.execute("call4", { maxResults: 1 });
    const { suggestions } = result.details as { suggestions: unknown[] };
    expect(suggestions).toHaveLength(1);
  });

  it("respects minScore — filters out suggestions below threshold", async () => {
    const tool = createToolOrThrow();
    // minScore of 0.90 should keep only the 0.91 edge
    const result = await tool.execute("call5", { minScore: 0.9 });
    const { suggestions } = result.details as {
      suggestions: Array<{ score: number }>;
    };
    for (const s of suggestions) {
      expect(s.score).toBeGreaterThanOrEqual(0.9);
    }
    expect(suggestions.length).toBeGreaterThan(0);
  });

  it("name filter narrows to candidates involving the named node", async () => {
    const tool = createToolOrThrow();
    // "Recipes" is the name of memory/recipes.md node
    const result = await tool.execute("call6", { name: "Recipes" });
    const { suggestions } = result.details as {
      suggestions: Array<{ from: string; to: string }>;
    };
    // Every suggestion must involve the recipes node
    for (const s of suggestions) {
      const involvedPaths = [s.from, s.to];
      expect(involvedPaths).toContain("memory/recipes.md");
    }
  });

  it("name filter is case-insensitive", async () => {
    const tool = createToolOrThrow();
    const result = await tool.execute("call7", { name: "recipes" });
    const { suggestions } = result.details as {
      suggestions: Array<{ from: string }>;
    };
    // "from" should be the matched node (recipes.md) when filter is applied
    for (const s of suggestions) {
      expect(s.from).toBe("memory/recipes.md");
    }
  });

  it("name filter also matches by filename stem", async () => {
    const tool = createToolOrThrow();
    // "tasks" is the stem of memory/tasks.md (node name is "Tasks")
    const result = await tool.execute("call8", { name: "tasks" });
    const { suggestions } = result.details as {
      suggestions: Array<{ from: string; to: string }>;
    };
    for (const s of suggestions) {
      const involvedPaths = [s.from, s.to];
      expect(involvedPaths).toContain("memory/tasks.md");
    }
  });

  it("includes generatedAtMs from the graph", async () => {
    const tool = createToolOrThrow();
    const result = await tool.execute("call9", {});
    const { generatedAtMs } = result.details as { generatedAtMs: number };
    expect(generatedAtMs).toBe(BASE_GRAPH.generatedAtMs);
  });

  it("returns disabled when manager has no graph method", async () => {
    setGraphUnavailable();
    const tool = createToolOrThrow();
    const result = await tool.execute("call10", {});
    const details = result.details as { disabled: boolean; reason: string; suggestions: unknown[] };
    expect(details.disabled).toBe(true);
    expect(details.reason).toBe("graph unavailable");
    expect(details.suggestions).toEqual([]);
  });

  it("returns count equal to suggestions length", async () => {
    const tool = createToolOrThrow();
    const result = await tool.execute("call11", {});
    const { count, suggestions } = result.details as {
      count: number;
      suggestions: unknown[];
    };
    expect(count).toBe(suggestions.length);
  });

  it("includes readyToPaste markdown when suggestions exist", async () => {
    const tool = createToolOrThrow();
    const result = await tool.execute("call12", {});
    const { readyToPaste, suggestions } = result.details as {
      readyToPaste?: string;
      suggestions: Array<{ toName: string }>;
    };
    if (suggestions.length > 0) {
      expect(typeof readyToPaste).toBe("string");
      expect(readyToPaste).toContain("## Related (suggested)");
    }
  });

  it("suggestedLink is [[toName]]", async () => {
    const tool = createToolOrThrow();
    const result = await tool.execute("call13", {});
    const { suggestions } = result.details as {
      suggestions: Array<{ toName: string; suggestedLink: string }>;
    };
    for (const s of suggestions) {
      expect(s.suggestedLink).toBe(`[[${s.toName}]]`);
    }
  });

  it("returns all unlinked similarity pairs when no name filter", async () => {
    const tool = createToolOrThrow();
    const result = await tool.execute("call14", {});
    const { suggestions } = result.details as { suggestions: unknown[] };
    // BASE_GRAPH has 3 similarity edges not matching wikilinks:
    // MEMORY.md↔recipes(0.91), projects↔tasks(0.88), recipes↔tasks(0.83)
    expect(suggestions).toHaveLength(3);
  });
});
