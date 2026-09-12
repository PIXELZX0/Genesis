import fs from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSuiteTempRootTracker } from "../test-helpers/temp-dir.js";
import { createConfigIO } from "./io.js";

const tempRoots = createSuiteTempRootTracker({ prefix: "genesis-config-split-sections-" });

beforeAll(async () => {
  await tempRoots.setup();
});

afterAll(async () => {
  await tempRoots.cleanup();
});

const silentLogger = { warn: () => {}, error: () => {} };

async function withHome(run: (home: string) => Promise<void>): Promise<void> {
  await run(await tempRoots.make("home"));
}

function ioFor(home: string) {
  const stateDir = path.join(home, ".genesis");
  return createConfigIO({
    env: { GENESIS_STATE_DIR: stateDir } as NodeJS.ProcessEnv,
    homedir: () => home,
    logger: silentLogger,
  });
}

async function readJson(filePath: string): Promise<Record<string, unknown>> {
  return JSON.parse(await fs.readFile(filePath, "utf-8")) as Record<string, unknown>;
}

describe("config write: split layout keeps new sections out of genesis.json", () => {
  it("routes a newly added top-level section into config/<key>.json", async () => {
    await withHome(async (home) => {
      const stateDir = path.join(home, ".genesis");
      const io = ioFor(home);
      // First write splits existing sections and creates the `config/` layout.
      await io.writeConfigFile({ gateway: { mode: "local" } });

      const snapshot = await io.readConfigFileSnapshot();
      const next = structuredClone(snapshot.sourceConfig ?? snapshot.resolved);
      next.mcp = { servers: { context7: { command: "uvx", args: ["context7-mcp"] } } };
      await io.writeConfigFile(next);

      const root = await readJson(path.join(stateDir, "genesis.json"));
      expect(root.mcp).toEqual({ $include: "config/mcp.json" });
      expect(await readJson(path.join(stateDir, "config", "mcp.json"))).toEqual({
        servers: { context7: { command: "uvx", args: ["context7-mcp"] } },
      });
    });
  });

  it("re-routes a section re-added after the whole section was deleted", async () => {
    await withHome(async (home) => {
      const stateDir = path.join(home, ".genesis");
      await fs.mkdir(path.join(stateDir, "config"), { recursive: true });
      // Section file left behind by an earlier whole-section delete (the root
      // marker is gone, the file is not).
      await fs.writeFile(
        path.join(stateDir, "config", "mcp.json"),
        `${JSON.stringify({ servers: { stale: { url: "https://stale.example/mcp" } } }, null, 2)}\n`,
        "utf-8",
      );
      await fs.writeFile(
        path.join(stateDir, "genesis.json"),
        `${JSON.stringify({ gateway: { mode: "local" } }, null, 2)}\n`,
        "utf-8",
      );

      const io = ioFor(home);
      const snapshot = await io.readConfigFileSnapshot();
      const next = structuredClone(snapshot.sourceConfig ?? snapshot.resolved);
      next.mcp = { servers: { fresh: { url: "https://fresh.example/mcp" } } };
      await io.writeConfigFile(next);

      const root = await readJson(path.join(stateDir, "genesis.json"));
      expect(root.mcp).toEqual({ $include: "config/mcp.json" });
      expect(await readJson(path.join(stateDir, "config", "mcp.json"))).toEqual({
        servers: { fresh: { url: "https://fresh.example/mcp" } },
      });
      expect(await io.readConfigFileSnapshot()).toMatchObject({
        resolved: { mcp: { servers: { fresh: { url: "https://fresh.example/mcp" } } } },
      });
    });
  });

  it("leaves flat configs flat", async () => {
    await withHome(async (home) => {
      const stateDir = path.join(home, ".genesis");
      await fs.mkdir(stateDir, { recursive: true });
      await fs.writeFile(
        path.join(stateDir, "genesis.json"),
        `${JSON.stringify({ gateway: { mode: "local" } }, null, 2)}\n`,
        "utf-8",
      );

      const io = ioFor(home);
      const snapshot = await io.readConfigFileSnapshot();
      const next = structuredClone(snapshot.sourceConfig ?? snapshot.resolved);
      next.mcp = { servers: { context7: { command: "uvx" } } };
      await io.writeConfigFile(next);

      const root = await readJson(path.join(stateDir, "genesis.json"));
      expect(root.mcp).toEqual({ servers: { context7: { command: "uvx" } } });
    });
  });
});
