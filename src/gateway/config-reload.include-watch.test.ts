import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConfigFileSnapshot, GenesisConfig } from "../config/config.js";
import { startGatewayConfigReloader, type GatewayConfigReloader } from "./config-reload.js";

const noopLog = { info: () => {}, warn: () => {}, error: () => {} };

function snapshotFor(params: {
  configPath: string;
  parsed: unknown;
  config: GenesisConfig;
  hash: string;
}): ConfigFileSnapshot {
  const config = params.config as ConfigFileSnapshot["config"];
  const sourceConfig = params.config as ConfigFileSnapshot["sourceConfig"];
  return {
    path: params.configPath,
    exists: true,
    raw: JSON.stringify(params.parsed),
    parsed: params.parsed,
    sourceConfig,
    resolved: sourceConfig,
    valid: true,
    runtimeConfig: config,
    config,
    hash: params.hash,
    issues: [],
    warnings: [],
    legacyIssues: [],
  };
}

describe("gateway config reloader include watching", () => {
  let reloader: GatewayConfigReloader | null = null;
  let tempDir: string | null = null;

  afterEach(async () => {
    await reloader?.stop();
    reloader = null;
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  it("hot-reloads when a $include section file changes on disk", async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "genesis-include-watch-"));
    const configPath = path.join(tempDir, "genesis.json");
    const includePath = path.join(tempDir, "config", "models.json");
    const parsed = { models: { $include: "config/models.json" } };
    await fs.mkdir(path.dirname(includePath), { recursive: true });
    await fs.writeFile(configPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf-8");
    await fs.writeFile(includePath, `${JSON.stringify({ mode: "merge" }, null, 2)}\n`, "utf-8");

    const initialConfig: GenesisConfig = {
      models: { mode: "merge" },
      gateway: { reload: { mode: "hot", debounceMs: 10 } },
    };
    const readSnapshot = async () => {
      const models = JSON.parse(await fs.readFile(includePath, "utf-8")) as Record<string, unknown>;
      const config: GenesisConfig = {
        models,
        gateway: { reload: { mode: "hot", debounceMs: 10 } },
      };
      return snapshotFor({ configPath, parsed, config, hash: JSON.stringify(models) });
    };
    const onHotReload = vi.fn(async () => {});

    reloader = startGatewayConfigReloader({
      initialConfig,
      readSnapshot,
      onHotReload,
      onRestart: () => {},
      log: noopLog,
      watchPath: configPath,
    });

    // Give the startup seed time to register the include watch, then edit the
    // include file exactly once so chokidar's awaitWriteFinish can settle.
    await new Promise((resolve) => setTimeout(resolve, 500));
    await fs.writeFile(includePath, `${JSON.stringify({ mode: "replace" }, null, 2)}\n`, "utf-8");
    await vi.waitFor(() => {
      expect(onHotReload).toHaveBeenCalled();
    }, 8000);

    const [, nextConfig] = onHotReload.mock.calls[0] as unknown as [unknown, GenesisConfig];
    expect(nextConfig.models).toEqual({ mode: "replace" });
  });
});
