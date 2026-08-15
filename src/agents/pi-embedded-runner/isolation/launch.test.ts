import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import {
  createPiIsolationRuntimeEnvironment,
  createPiIsolationSpawnEnvironment,
  resolvePiIsolationChildLaunch,
} from "./launch.js";

describe("PI isolation child launch", () => {
  it("uses the current Node runtime and keeps credentials out of argv", () => {
    const launch = resolvePiIsolationChildLaunch({
      execPath: process.execPath,
      moduleUrl: import.meta.url,
    });
    expect(launch.command).toBe(process.execPath);
    expect(launch.args.at(-1)).toBe(launch.entryPath);
    expect(launch.args.join(" ")).not.toContain("sk-test-secret");
    expect(launch.args).not.toContain("--api-key");
  });

  it("preserves the Bun launch path without a Node loader", () => {
    const launch = resolvePiIsolationChildLaunch({
      execPath: "/opt/bun/bin/bun",
      moduleUrl: import.meta.url,
    });
    expect(launch.command).toBe("/opt/bun/bin/bun");
    expect(launch.args).toEqual([launch.entryPath]);
  });

  it("uses the built entry directly when the parent is running from dist", () => {
    const packageRoot = process.cwd();
    const builtEntry = path.join(packageRoot, "dist", "agents", "pi-isolated-child.js");
    const launch = resolvePiIsolationChildLaunch({
      execPath: process.execPath,
      moduleUrl: pathToFileURL(path.join(packageRoot, "dist", "agents", "isolation-parent.js"))
        .href,
      existsSync: (filePath) => filePath === builtEntry,
    });

    expect(launch).toMatchObject({ entryPath: builtEntry, source: false });
    expect(launch.args).toEqual([builtEntry]);
  });

  it("keeps startup env minimal and forwards only non-secret runtime paths", () => {
    const env = {
      HOME: "/tmp/home",
      USERPROFILE: "C:\\Users\\test",
      PATH: "/usr/bin",
      NODE_OPTIONS: "--require=/tmp/inject.cjs",
      OPENAI_API_KEY: "sk-secret",
      GENESIS_GATEWAY_TOKEN: "gateway-secret",
      GENESIS_STATE_DIR: "/tmp/state",
      GENESIS_BUNDLED_PLUGINS_DIR: "/tmp/plugins",
      GENESIS_PROFILE: "dev",
      GENESIS_RAW_STREAM: "1",
      GENESIS_RAW_STREAM_PATH: "/tmp/raw-stream.jsonl",
      GENESIS_SESSION_MANAGER_CACHE_TTL_MS: "2500",
    };

    expect(createPiIsolationSpawnEnvironment({ env, tsconfigPath: "/tmp/tsconfig.json" })).toEqual({
      HOME: "/tmp/home",
      USERPROFILE: "C:\\Users\\test",
      PATH: "/usr/bin",
      GENESIS_PI_ISOLATION_CHILD: "1",
      TSX_TSCONFIG_PATH: "/tmp/tsconfig.json",
    });
    expect(createPiIsolationRuntimeEnvironment(env)).toEqual({
      GENESIS_BUNDLED_PLUGINS_DIR: "/tmp/plugins",
      GENESIS_PROFILE: "dev",
      GENESIS_RAW_STREAM: "1",
      GENESIS_RAW_STREAM_PATH: "/tmp/raw-stream.jsonl",
      GENESIS_SESSION_MANAGER_CACHE_TTL_MS: "2500",
      GENESIS_STATE_DIR: "/tmp/state",
    });
  });
});
