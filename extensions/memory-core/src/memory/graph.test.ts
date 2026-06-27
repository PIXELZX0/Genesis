import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import {
  ensureMemoryIndexSchema,
  requireNodeSqlite,
} from "genesis/plugin-sdk/memory-core-host-engine-storage";
import { afterEach, describe, expect, it } from "vitest";
import { buildMemoryGraph, parseGraphFrontmatter } from "./graph.js";

const { DatabaseSync: SqliteDb } = requireNodeSqlite();

type Cleanup = () => Promise<void>;
const cleanups: Cleanup[] = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    const cleanup = cleanups.pop();
    if (cleanup) {
      await cleanup();
    }
  }
});

async function makeWorkspace(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "memory-graph-"));
  cleanups.push(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  return dir;
}

function makeDb(): DatabaseSync {
  const db = new SqliteDb(":memory:");
  ensureMemoryIndexSchema({
    db,
    embeddingCacheTable: "embedding_cache",
    cacheEnabled: false,
    ftsTable: "chunks_fts",
    ftsEnabled: false,
  });
  cleanups.push(async () => {
    db.close();
  });
  return db;
}

async function writeMemoryFile(
  workspaceDir: string,
  relPath: string,
  content: string,
): Promise<void> {
  const abs = path.join(workspaceDir, relPath);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, content, "utf8");
}

function insertChunk(
  db: DatabaseSync,
  params: { id: string; relPath: string; embedding: number[] },
): void {
  db.prepare(
    `INSERT INTO chunks (id, path, source, start_line, end_line, hash, model, text, embedding, updated_at)
     VALUES (?, ?, 'memory', 1, 1, ?, 'mock-embed', ?, ?, ?)`,
  ).run(
    params.id,
    params.relPath,
    `hash-${params.id}`,
    `text-${params.id}`,
    JSON.stringify(params.embedding),
    Date.now(),
  );
}

describe("parseGraphFrontmatter", () => {
  it("parses name, description, and nested metadata.type", () => {
    const parsed = parseGraphFrontmatter(
      [
        "---",
        "name: Alpha Note",
        "description: about alpha",
        "metadata:",
        "  type: concept",
        "---",
        "",
        "body",
      ].join("\n"),
    );
    expect(parsed.name).toBe("Alpha Note");
    expect(parsed.description).toBe("about alpha");
    expect(parsed.type).toBe("concept");
  });

  it("parses top-level type and strips quotes", () => {
    const parsed = parseGraphFrontmatter(
      ["---", 'name: "Quoted"', "type: 'fact'", "---", "x"].join("\n"),
    );
    expect(parsed.name).toBe("Quoted");
    expect(parsed.type).toBe("fact");
  });

  it("returns empty for content without frontmatter", () => {
    expect(parseGraphFrontmatter("just body text")).toEqual({});
  });
});

describe("buildMemoryGraph nodes", () => {
  it("enumerates memory/*.md + MEMORY.md and parses frontmatter", async () => {
    const workspaceDir = await makeWorkspace();
    const db = makeDb();
    await writeMemoryFile(
      workspaceDir,
      "MEMORY.md",
      ["---", "name: Root Index", "description: top level", "---", "root body"].join("\n"),
    );
    await writeMemoryFile(
      workspaceDir,
      "memory/alpha.md",
      ["---", "name: Alpha", "metadata:", "  type: concept", "---", "alpha body"].join("\n"),
    );
    await writeMemoryFile(workspaceDir, "memory/nested/beta.md", "no frontmatter body");

    const result = await buildMemoryGraph({ db, workspaceDir, provider: null });

    const byPath = new Map(result.nodes.map((n) => [n.path, n]));
    expect([...byPath.keys()].toSorted((a, b) => (a < b ? -1 : a > b ? 1 : 0))).toEqual([
      "MEMORY.md",
      "memory/alpha.md",
      "memory/nested/beta.md",
    ]);
    expect(byPath.get("MEMORY.md")?.name).toBe("Root Index");
    expect(byPath.get("MEMORY.md")?.description).toBe("top level");
    expect(byPath.get("memory/alpha.md")?.type).toBe("concept");
    // fallback name = filename stem when no frontmatter name
    expect(byPath.get("memory/nested/beta.md")?.name).toBe("beta");
    for (const node of result.nodes) {
      expect(node.size).toBeGreaterThan(0);
      expect(node.mtimeMs).toBeGreaterThan(0);
    }
    expect(result.generatedAtMs).toBeGreaterThan(0);
  });

  it("prefers files-table size/mtime over fs.stat", async () => {
    const workspaceDir = await makeWorkspace();
    const db = makeDb();
    await writeMemoryFile(workspaceDir, "memory/alpha.md", "alpha body");
    db.prepare(
      `INSERT INTO files (path, source, hash, mtime, size) VALUES (?, 'memory', 'h', ?, ?)`,
    ).run("memory/alpha.md", 123456, 999);

    const result = await buildMemoryGraph({ db, workspaceDir, provider: null });
    const node = result.nodes.find((n) => n.path === "memory/alpha.md");
    expect(node?.size).toBe(999);
    expect(node?.mtimeMs).toBe(123456);
  });
});

describe("buildMemoryGraph wikilink edges", () => {
  it("resolves wikilinks by name + stem, handles alias, dedups, skips unresolved/self", async () => {
    const workspaceDir = await makeWorkspace();
    const db = makeDb();
    await writeMemoryFile(
      workspaceDir,
      "memory/alpha.md",
      [
        "---",
        "name: Alpha",
        "---",
        "links to [[Beta]] and again [[Beta|the beta]]",
        "and to [[gamma]] by stem",
        "and to [[Nonexistent]] unresolved",
        "and self [[Alpha]]",
      ].join("\n"),
    );
    await writeMemoryFile(
      workspaceDir,
      "memory/beta.md",
      ["---", "name: Beta", "---", "beta"].join("\n"),
    );
    await writeMemoryFile(workspaceDir, "memory/gamma.md", "gamma body");

    const result = await buildMemoryGraph({ db, workspaceDir, provider: null });
    const wikilinks = result.edges.filter((e) => e.type === "wikilink");

    expect(wikilinks).toContainEqual({
      source: "memory/alpha.md",
      target: "memory/beta.md",
      type: "wikilink",
      weight: 1,
    });
    expect(wikilinks).toContainEqual({
      source: "memory/alpha.md",
      target: "memory/gamma.md",
      type: "wikilink",
      weight: 1,
    });
    // dedup: Beta appears twice (plain + alias) -> single edge
    expect(wikilinks.filter((e) => e.target === "memory/beta.md")).toHaveLength(1);
    // unresolved + self skipped
    expect(wikilinks.some((e) => e.target === "memory/alpha.md")).toBe(false);
    expect(wikilinks).toHaveLength(2);
  });
});

describe("buildMemoryGraph similarity edges", () => {
  it("emits similarity edges respecting threshold, top-K, undirected dedup", async () => {
    const workspaceDir = await makeWorkspace();
    const db = makeDb();
    // Four files; a/b near-identical (cosine ~1), c orthogonal, d also close to a.
    await writeMemoryFile(workspaceDir, "memory/a.md", "a");
    await writeMemoryFile(workspaceDir, "memory/b.md", "b");
    await writeMemoryFile(workspaceDir, "memory/c.md", "c");
    await writeMemoryFile(workspaceDir, "memory/d.md", "d");
    insertChunk(db, { id: "a1", relPath: "memory/a.md", embedding: [1, 0, 0] });
    insertChunk(db, { id: "b1", relPath: "memory/b.md", embedding: [0.99, 0.01, 0] });
    insertChunk(db, { id: "c1", relPath: "memory/c.md", embedding: [0, 1, 0] });
    insertChunk(db, { id: "d1", relPath: "memory/d.md", embedding: [0.98, 0.02, 0] });

    const result = await buildMemoryGraph({
      db,
      workspaceDir,
      provider: {},
      similarityThreshold: 0.82,
      similarityTopK: 4,
    });
    const sim = result.edges.filter((e) => e.type === "similarity");

    // c orthogonal -> no edges to it
    expect(sim.some((e) => e.source === "memory/c.md" || e.target === "memory/c.md")).toBe(false);
    // undirected dedup: source < target by path, each pair once
    for (const e of sim) {
      expect(e.source < e.target).toBe(true);
      expect(e.weight).toBeGreaterThanOrEqual(0.82);
    }
    const keys = sim.map((e) => `${e.source}|${e.target}`);
    expect(new Set(keys).size).toBe(keys.length);
    // a/b/d mutually close -> the 3 pairs among them present
    expect(keys).toContain("memory/a.md|memory/b.md");
    expect(keys).toContain("memory/a.md|memory/d.md");
    expect(keys).toContain("memory/b.md|memory/d.md");
  });

  it("respects top-K cap per node", async () => {
    const workspaceDir = await makeWorkspace();
    const db = makeDb();
    // One hub close to 5 others; topK=2 should cap hub's degree.
    const files = ["hub", "n1", "n2", "n3", "n4", "n5"];
    for (const f of files) {
      await writeMemoryFile(workspaceDir, `memory/${f}.md`, f);
    }
    insertChunk(db, { id: "hub", relPath: "memory/hub.md", embedding: [1, 0] });
    for (let i = 1; i <= 5; i += 1) {
      insertChunk(db, {
        id: `n${i}`,
        relPath: `memory/n${i}.md`,
        embedding: [1, i * 0.001],
      });
    }

    const result = await buildMemoryGraph({
      db,
      workspaceDir,
      provider: {},
      similarityThreshold: 0.82,
      similarityTopK: 2,
    });
    const sim = result.edges.filter((e) => e.type === "similarity");
    const hubEdges = sim.filter(
      (e) => e.source === "memory/hub.md" || e.target === "memory/hub.md",
    );
    expect(hubEdges.length).toBeLessThanOrEqual(2);
  });

  it("emits no similarity edges when provider is null", async () => {
    const workspaceDir = await makeWorkspace();
    const db = makeDb();
    await writeMemoryFile(workspaceDir, "memory/a.md", "a");
    await writeMemoryFile(workspaceDir, "memory/b.md", "b");
    insertChunk(db, { id: "a1", relPath: "memory/a.md", embedding: [1, 0] });
    insertChunk(db, { id: "b1", relPath: "memory/b.md", embedding: [1, 0] });

    const result = await buildMemoryGraph({ db, workspaceDir, provider: null });
    expect(result.edges.some((e) => e.type === "similarity")).toBe(false);
  });
});

describe("buildMemoryGraph tag edges", () => {
  it("connects files sharing concept tags, weight = shared-tag count", async () => {
    const workspaceDir = await makeWorkspace();
    const db = makeDb();
    await writeMemoryFile(
      workspaceDir,
      "memory/one.md",
      "Discussion of kubernetes clustering and prometheus monitoring dashboards.",
    );
    await writeMemoryFile(
      workspaceDir,
      "memory/two.md",
      "More about kubernetes clustering plus prometheus alerting rules.",
    );
    await writeMemoryFile(
      workspaceDir,
      "memory/three.md",
      "Completely separate banana smoothie recipe ingredients list.",
    );

    const result = await buildMemoryGraph({ db, workspaceDir, provider: null });
    const tagEdges = result.edges.filter((e) => e.type === "tag");

    const oneTwo = tagEdges.find(
      (e) =>
        (e.source === "memory/one.md" && e.target === "memory/two.md") ||
        (e.source === "memory/two.md" && e.target === "memory/one.md"),
    );
    expect(oneTwo).toBeDefined();
    expect(oneTwo?.weight).toBeGreaterThanOrEqual(1);
    // undirected, source < target
    expect(oneTwo?.source).toBe("memory/one.md");
    // three shares nothing -> no tag edge to it
    expect(
      tagEdges.some((e) => e.source === "memory/three.md" || e.target === "memory/three.md"),
    ).toBe(false);
  });
});
