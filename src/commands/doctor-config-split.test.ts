import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { readConfigFileSnapshot } from "../config/io.js";
import { withTempHomeConfig } from "../config/test-helpers.js";
import {
  applyConfigSplitMigration,
  collectSplittableTopLevelKeys,
  maybeSplitConfigLayout,
} from "./doctor-config-split.js";

const MONOLITH = {
  gateway: { mode: "local" },
  agents: { defaults: { model: "anthropic/sonnet-4.6" } },
  plugins: { entries: { demo: { enabled: true } } },
  skills: { entries: {} },
};

describe("doctor config split", () => {
  it("collects splittable keys, excluding restart infra and $include-authored sections", () => {
    expect(
      collectSplittableTopLevelKeys({
        $schema: "https://example/schema.json",
        meta: {},
        gateway: { mode: "local" },
        discovery: {},
        canvasHost: {},
        agents: { defaults: {} },
        models: { $include: "config/models.json" },
        update: "not-a-record",
      }),
    ).toEqual(["agents"]);
  });

  it("splits authored sections into config/<key>.json and keeps the resolved config identical", async () => {
    await withTempHomeConfig(MONOLITH, async ({ home, configPath }) => {
      const before = await readConfigFileSnapshot();
      const result = await applyConfigSplitMigration();
      expect(result).toMatchObject({
        status: "split",
        keys: ["agents", "plugins", "skills"],
      });

      const root = JSON.parse(await fs.readFile(configPath, "utf-8")) as Record<string, unknown>;
      expect(root.gateway).toEqual({ mode: "local" });
      expect(root.agents).toEqual({ $include: "config/agents.json" });
      expect(root.plugins).toEqual({ $include: "config/plugins.json" });
      expect(root.skills).toEqual({ $include: "config/skills.json" });
      const agents = JSON.parse(
        await fs.readFile(path.join(home, ".genesis", "config", "agents.json"), "utf-8"),
      );
      expect(agents).toEqual(MONOLITH.agents);

      const after = await readConfigFileSnapshot();
      expect(after.valid).toBe(true);
      expect(after.resolved).toEqual(before.resolved);

      // Idempotent: a second run finds nothing left to split.
      await expect(applyConfigSplitMigration()).resolves.toEqual({
        status: "skipped",
        reason: "nothing-to-split",
      });
    });
  });

  it("preserves literal ${VAR} references byte-for-byte when splitting", async () => {
    const monolith = {
      gateway: { mode: "local" },
      plugins: { entries: { demo: { enabled: true, config: { token: "${DEMO_TOKEN}" } } } },
    };
    await withTempHomeConfig(monolith, async ({ home }) => {
      process.env.DEMO_TOKEN = "sekret";
      try {
        const result = await applyConfigSplitMigration();
        expect(result.status).toBe("split");
        const pluginsRaw = await fs.readFile(
          path.join(home, ".genesis", "config", "plugins.json"),
          "utf-8",
        );
        expect(pluginsRaw).toContain('"${DEMO_TOKEN}"');
        expect(pluginsRaw).not.toContain("sekret");
      } finally {
        delete process.env.DEMO_TOKEN;
      }
    });
  });

  it("always splits, regardless of --yes/--fix/non-interactive", async () => {
    await withTempHomeConfig(MONOLITH, async ({ configPath }) => {
      const note = vi.fn();
      const result = await maybeSplitConfigLayout({
        options: { yes: true },
        note,
      });
      expect(result?.status).toBe("split");
      const root = JSON.parse(await fs.readFile(configPath, "utf-8")) as Record<string, unknown>;
      expect(root.agents).toEqual({ $include: "config/agents.json" });
      expect(note).toHaveBeenCalledWith(
        expect.stringContaining("config/agents.json"),
        "Config split",
      );
    });
  });

  it("splits a schema-invalid config (e.g. a stale bundled-schema false positive) as long as the resolved structure is unchanged by the move", async () => {
    await withTempHomeConfig(MONOLITH, async ({ configPath }) => {
      const realSnapshot = await readConfigFileSnapshot();
      const fakeInvalidSnapshot = { ...realSnapshot, valid: false };
      const result = await applyConfigSplitMigration(fakeInvalidSnapshot);
      expect(result.status).toBe("split");
      const root = JSON.parse(await fs.readFile(configPath, "utf-8")) as Record<string, unknown>;
      expect(root.agents).toEqual({ $include: "config/agents.json" });
    });
  });
});
