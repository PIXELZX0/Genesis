import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { withTempDir } from "./test-helpers/temp-dir.js";
import {
  ensureDir,
  resolveConfigDir,
  resolveHomeDir,
  resolveUserPath,
  shortenHomeInString,
  shortenHomePath,
  sleep,
} from "./utils.js";

describe("ensureDir", () => {
  it("creates nested directory", async () => {
    await withTempDir({ prefix: "genesis-test-" }, async (tmp) => {
      const target = path.join(tmp, "nested", "dir");
      await ensureDir(target);
      expect(fs.existsSync(target)).toBe(true);
    });
  });
});

describe("sleep", () => {
  it("resolves after delay using fake timers", async () => {
    vi.useFakeTimers();
    const promise = sleep(1000);
    vi.advanceTimersByTime(1000);
    await expect(promise).resolves.toBeUndefined();
    vi.useRealTimers();
  });
});

describe("resolveConfigDir", () => {
  it("prefers ~/.genesis when legacy dir is missing", async () => {
    await withTempDir({ prefix: "genesis-config-dir-" }, async (root) => {
      const newDir = path.join(root, ".genesis");
      await fs.promises.mkdir(newDir, { recursive: true });
      const resolved = resolveConfigDir({} as NodeJS.ProcessEnv, () => root);
      expect(resolved).toBe(newDir);
    });
  });

  it("expands GENESIS_STATE_DIR using the provided env", () => {
    const env = {
      HOME: "/tmp/genesis-home",
      GENESIS_STATE_DIR: "~/state",
    } as NodeJS.ProcessEnv;

    expect(resolveConfigDir(env)).toBe(path.resolve("/tmp/genesis-home", "state"));
  });

  it("falls back to the config file directory when only GENESIS_CONFIG_PATH is set", () => {
    const env = {
      HOME: "/tmp/genesis-home",
      GENESIS_CONFIG_PATH: "~/profiles/dev/genesis.json",
    } as NodeJS.ProcessEnv;

    expect(resolveConfigDir(env)).toBe(path.resolve("/tmp/genesis-home", "profiles", "dev"));
  });
});

describe("resolveHomeDir", () => {
  it("prefers GENESIS_HOME over HOME", () => {
    vi.stubEnv("GENESIS_HOME", "/srv/genesis-home");
    vi.stubEnv("HOME", "/home/other");

    expect(resolveHomeDir()).toBe(path.resolve("/srv/genesis-home"));

    vi.unstubAllEnvs();
  });
});

describe("shortenHomePath", () => {
  it("uses $GENESIS_HOME prefix when GENESIS_HOME is set", () => {
    vi.stubEnv("GENESIS_HOME", "/srv/genesis-home");
    vi.stubEnv("HOME", "/home/other");

    expect(shortenHomePath(`${path.resolve("/srv/genesis-home")}/.genesis/genesis.json`)).toBe(
      "$GENESIS_HOME/.genesis/genesis.json",
    );

    vi.unstubAllEnvs();
  });
});

describe("shortenHomeInString", () => {
  it("uses $GENESIS_HOME replacement when GENESIS_HOME is set", () => {
    vi.stubEnv("GENESIS_HOME", "/srv/genesis-home");
    vi.stubEnv("HOME", "/home/other");

    expect(
      shortenHomeInString(`config: ${path.resolve("/srv/genesis-home")}/.genesis/genesis.json`),
    ).toBe("config: $GENESIS_HOME/.genesis/genesis.json");

    vi.unstubAllEnvs();
  });
});

describe("resolveUserPath", () => {
  it("expands ~ to home dir", () => {
    expect(resolveUserPath("~", {}, () => "/Users/thoffman")).toBe(path.resolve("/Users/thoffman"));
  });

  it("expands ~/ to home dir", () => {
    expect(resolveUserPath("~/genesis", {}, () => "/Users/thoffman")).toBe(
      path.resolve("/Users/thoffman", "genesis"),
    );
  });

  it("resolves relative paths", () => {
    expect(resolveUserPath("tmp/dir")).toBe(path.resolve("tmp/dir"));
  });

  it("prefers GENESIS_HOME for tilde expansion", () => {
    vi.stubEnv("GENESIS_HOME", "/srv/genesis-home");
    vi.stubEnv("HOME", "/home/other");

    expect(resolveUserPath("~/genesis")).toBe(path.resolve("/srv/genesis-home", "genesis"));

    vi.unstubAllEnvs();
  });

  it("uses the provided env for tilde expansion", () => {
    const env = {
      HOME: "/tmp/genesis-home",
      GENESIS_HOME: "/srv/genesis-home",
    } as NodeJS.ProcessEnv;

    expect(resolveUserPath("~/genesis", env)).toBe(path.resolve("/srv/genesis-home", "genesis"));
  });

  it("keeps blank paths blank", () => {
    expect(resolveUserPath("")).toBe("");
    expect(resolveUserPath("   ")).toBe("");
  });

  it("returns empty string for undefined/null input", () => {
    expect(resolveUserPath(undefined as unknown as string)).toBe("");
    expect(resolveUserPath(null as unknown as string)).toBe("");
  });
});
