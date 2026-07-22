import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { withTempDir } from "../test-helpers/temp-dir.js";
import { loadConfig, resetConfigRuntimeState } from "./io.js";

describe("loadConfig runtime pinning", () => {
  afterEach(() => {
    resetConfigRuntimeState();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  // Gateway RPC handlers, WS connects, and the reply pipeline all call loadConfig
  // on hot paths; it must not re-read and re-parse genesis.json each time.
  it("parses the config file once per process instead of on every call", async () => {
    await withTempDir({ prefix: "genesis-load-config-pinning-" }, async (dir) => {
      const configPath = path.join(dir, "genesis.json");
      await fs.writeFile(configPath, JSON.stringify({ gateway: { port: 18999 } }), "utf8");
      vi.stubEnv("GENESIS_CONFIG_PATH", configPath);
      resetConfigRuntimeState();

      expect(loadConfig().gateway?.port).toBe(18999);

      const readSpy = vi.spyOn(fsSync, "readFileSync");
      expect(loadConfig().gateway?.port).toBe(18999);
      expect(loadConfig().gateway?.port).toBe(18999);
      expect(readSpy.mock.calls.filter(([target]) => String(target) === configPath)).toHaveLength(
        0,
      );
    });
  });
});
