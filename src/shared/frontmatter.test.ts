import { describe, expect, it, test } from "vitest";
import {
  applyGenesisManifestInstallCommonFields,
  getFrontmatterString,
  normalizeStringList,
  parseFrontmatterBool,
  parseGenesisManifestInstallBase,
  resolveGenesisManifestBlock,
  resolveGenesisManifestInstall,
  resolveGenesisManifestOs,
  resolveGenesisManifestRequires,
} from "./frontmatter.js";

describe("shared/frontmatter", () => {
  test("normalizeStringList handles strings, arrays, and non-list values", () => {
    expect(normalizeStringList("a, b,,c")).toEqual(["a", "b", "c"]);
    expect(normalizeStringList([" a ", "", "b", 42])).toEqual(["a", "b", "42"]);
    expect(normalizeStringList(null)).toEqual([]);
  });

  test("getFrontmatterString extracts strings only", () => {
    expect(getFrontmatterString({ a: "b" }, "a")).toBe("b");
    expect(getFrontmatterString({ a: 1 }, "a")).toBeUndefined();
  });

  test("parseFrontmatterBool respects explicit values and fallback", () => {
    expect(parseFrontmatterBool("true", false)).toBe(true);
    expect(parseFrontmatterBool("false", true)).toBe(false);
    expect(parseFrontmatterBool(undefined, true)).toBe(true);
    expect(parseFrontmatterBool("maybe", false)).toBe(false);
  });

  test("resolveGenesisManifestBlock reads current manifest keys and custom metadata fields", () => {
    expect(
      resolveGenesisManifestBlock({
        frontmatter: {
          metadata: "{ genesis: { foo: 1, bar: 'baz' } }",
        },
      }),
    ).toEqual({ foo: 1, bar: "baz" });

    expect(
      resolveGenesisManifestBlock({
        frontmatter: {
          pluginMeta: "{ genesis: { foo: 2 } }",
        },
        key: "pluginMeta",
      }),
    ).toEqual({ foo: 2 });
  });

  test("resolveGenesisManifestBlock reads legacy manifest keys", () => {
    expect(
      resolveGenesisManifestBlock({
        frontmatter: {
          metadata: "{ clawdbot: { requires: { bins: ['op'] }, install: [] } }",
        },
      }),
    ).toEqual({ requires: { bins: ["op"] }, install: [] });
  });

  test("resolveGenesisManifestBlock prefers current manifest keys over legacy keys", () => {
    expect(
      resolveGenesisManifestBlock({
        frontmatter: {
          metadata:
            "{ genesis: { requires: { bins: ['current'] } }, clawdbot: { requires: { bins: ['legacy'] } } }",
        },
      }),
    ).toEqual({ requires: { bins: ["current"] } });
  });

  test("resolveGenesisManifestBlock returns undefined for invalid input", () => {
    expect(resolveGenesisManifestBlock({ frontmatter: {} })).toBeUndefined();
    expect(resolveGenesisManifestBlock({ frontmatter: { metadata: "not-json5" } })).toBeUndefined();
    expect(resolveGenesisManifestBlock({ frontmatter: { metadata: "123" } })).toBeUndefined();
    expect(resolveGenesisManifestBlock({ frontmatter: { metadata: "[]" } })).toBeUndefined();
    expect(
      resolveGenesisManifestBlock({ frontmatter: { metadata: "{ nope: { a: 1 } }" } }),
    ).toBeUndefined();
  });

  it("normalizes manifest requirement and os lists", () => {
    expect(
      resolveGenesisManifestRequires({
        requires: {
          bins: "bun, node",
          anyBins: [" ffmpeg ", ""],
          env: ["GENESIS_TOKEN", " GENESIS_URL "],
          config: null,
        },
      }),
    ).toEqual({
      bins: ["bun", "node"],
      anyBins: ["ffmpeg"],
      env: ["GENESIS_TOKEN", "GENESIS_URL"],
      config: [],
    });
    expect(resolveGenesisManifestRequires({})).toBeUndefined();
    expect(resolveGenesisManifestOs({ os: [" darwin ", "linux", ""] })).toEqual([
      "darwin",
      "linux",
    ]);
  });

  it("parses and applies install common fields", () => {
    const parsed = parseGenesisManifestInstallBase(
      {
        type: " Brew ",
        id: "brew.git",
        label: "Git",
        bins: [" git ", "git"],
      },
      ["brew", "npm"],
    );

    expect(parsed).toEqual({
      raw: {
        type: " Brew ",
        id: "brew.git",
        label: "Git",
        bins: [" git ", "git"],
      },
      kind: "brew",
      id: "brew.git",
      label: "Git",
      bins: ["git", "git"],
    });
    expect(parseGenesisManifestInstallBase({ kind: "bad" }, ["brew"])).toBeUndefined();
    expect(
      applyGenesisManifestInstallCommonFields<{
        extra: boolean;
        id?: string;
        label?: string;
        bins?: string[];
      }>({ extra: true }, parsed!),
    ).toEqual({
      extra: true,
      id: "brew.git",
      label: "Git",
      bins: ["git", "git"],
    });
  });

  it("prefers explicit kind, ignores invalid common fields, and leaves missing ones untouched", () => {
    const parsed = parseGenesisManifestInstallBase(
      {
        kind: " npm ",
        type: "brew",
        id: 42,
        label: null,
        bins: [" ", ""],
      },
      ["brew", "npm"],
    );

    expect(parsed).toEqual({
      raw: {
        kind: " npm ",
        type: "brew",
        id: 42,
        label: null,
        bins: [" ", ""],
      },
      kind: "npm",
    });
    expect(
      applyGenesisManifestInstallCommonFields(
        { id: "keep", label: "Keep", bins: ["bun"] },
        parsed!,
      ),
    ).toEqual({
      id: "keep",
      label: "Keep",
      bins: ["bun"],
    });
  });

  it("maps install entries through the parser and filters rejected specs", () => {
    expect(
      resolveGenesisManifestInstall(
        {
          install: [{ id: "keep" }, { id: "drop" }, "bad"],
        },
        (entry) => {
          if (
            typeof entry === "object" &&
            entry !== null &&
            (entry as { id?: string }).id === "keep"
          ) {
            return { id: "keep" };
          }
          return undefined;
        },
      ),
    ).toEqual([{ id: "keep" }]);
  });
});
