import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  readConfigFileSnapshot,
  registerConfigWriteListener,
  writeConfigFileWithResult,
} from "./io.js";
import { mutateConfigFile } from "./mutate.js";
import { withEnvOverride, withTempHome } from "./test-helpers.js";
import type { GenesisConfig } from "./types.js";

async function writeSplitFixture(home: string): Promise<{
  configPath: string;
  configDir: string;
}> {
  const configPath = path.join(home, ".genesis", "genesis.json");
  const configDir = path.join(home, ".genesis", "config");
  await fs.mkdir(configDir, { recursive: true });
  await fs.writeFile(
    configPath,
    `${JSON.stringify(
      {
        gateway: { mode: "local" },
        agents: { $include: "config/agents.json" },
        plugins: { $include: "config/plugins.json" },
      },
      null,
      2,
    )}\n`,
    "utf-8",
  );
  await fs.writeFile(
    path.join(configDir, "agents.json"),
    `${JSON.stringify({ defaults: { model: "anthropic/sonnet-4.6" } }, null, 2)}\n`,
    "utf-8",
  );
  await fs.writeFile(
    path.join(configDir, "plugins.json"),
    `${JSON.stringify(
      {
        entries: {
          demo: { enabled: true, config: { token: "${DEMO_TOKEN}" } },
        },
      },
      null,
      2,
    )}\n`,
    "utf-8",
  );
  return { configPath, configDir };
}

async function readJson(filePath: string): Promise<Record<string, unknown>> {
  return JSON.parse(await fs.readFile(filePath, "utf-8")) as Record<string, unknown>;
}

describe("config io include write routing", () => {
  it("routes a mutateConfigFile section change into the owning include file", async () => {
    await withEnvOverride({ DEMO_TOKEN: "sekret-token" }, async () => {
      await withTempHome(async (home) => {
        const { configPath, configDir } = await writeSplitFixture(home);

        await mutateConfigFile({
          mutate: (draft) => {
            draft.agents = {
              ...draft.agents,
              defaults: { model: "anthropic/claude-fable-5" },
            };
          },
        });

        const root = await readJson(configPath);
        expect(root.agents).toEqual({ $include: "config/agents.json" });
        expect(root.plugins).toEqual({ $include: "config/plugins.json" });
        const agents = await readJson(path.join(configDir, "agents.json"));
        expect(agents).toEqual({ defaults: { model: "anthropic/claude-fable-5" } });
        // Untouched section file keeps its bytes (including the ${VAR} ref).
        const pluginsRaw = await fs.readFile(path.join(configDir, "plugins.json"), "utf-8");
        expect(pluginsRaw).toContain('"${DEMO_TOKEN}"');
      });
    });
  });

  it("fans a multi-section writeConfigFileWithResult change out to both include files", async () => {
    await withEnvOverride({ DEMO_TOKEN: "sekret-token" }, async () => {
      await withTempHome(async (home) => {
        const { configPath, configDir } = await writeSplitFixture(home);
        const snapshot = await readConfigFileSnapshot();
        const next = structuredClone(snapshot.sourceConfig) as GenesisConfig;
        next.agents = { defaults: { model: "openai/gpt-5.4" } };
        next.plugins = {
          entries: {
            demo: { enabled: false, config: { token: "sekret-token" } },
          },
        };

        await writeConfigFileWithResult(next, { baseSnapshot: snapshot });

        const root = await readJson(configPath);
        expect(root.agents).toEqual({ $include: "config/agents.json" });
        expect(root.plugins).toEqual({ $include: "config/plugins.json" });
        const agents = await readJson(path.join(configDir, "agents.json"));
        expect(agents).toEqual({ defaults: { model: "openai/gpt-5.4" } });
        const plugins = await readJson(path.join(configDir, "plugins.json"));
        expect(plugins).toMatchObject({ entries: { demo: { enabled: false } } });
        // token path itself unchanged (resolved value matches env), so the
        // ${VAR} reference is restored instead of persisting the secret.
        const pluginsRaw = await fs.readFile(path.join(configDir, "plugins.json"), "utf-8");
        expect(pluginsRaw).toContain('"${DEMO_TOKEN}"');
        expect(pluginsRaw).not.toContain("sekret-token");
      });
    });
  });

  it("fires the runtime write notification with resolved section values", async () => {
    await withEnvOverride({ DEMO_TOKEN: "sekret-token" }, async () => {
      await withTempHome(async (home) => {
        await writeSplitFixture(home);
        const events: GenesisConfig[] = [];
        const unregister = registerConfigWriteListener((event) => {
          events.push(event.sourceConfig);
        });
        try {
          await mutateConfigFile({
            mutate: (draft) => {
              draft.agents = { defaults: { model: "anthropic/claude-fable-5" } };
            },
          });
        } finally {
          unregister();
        }
        expect(events).toHaveLength(1);
        // Listener sees resolved section values, never $include markers.
        expect(events[0]?.agents).toEqual({ defaults: { model: "anthropic/claude-fable-5" } });
      });
    });
  });

  it("still rejects writes into nested (non-top-level) include-owned config", async () => {
    await withTempHome(async (home) => {
      const configPath = path.join(home, ".genesis", "genesis.json");
      const configDir = path.join(home, ".genesis", "config");
      await fs.mkdir(configDir, { recursive: true });
      await fs.writeFile(
        configPath,
        `${JSON.stringify(
          { agents: { defaults: { $include: "config/agent-defaults.json" } } },
          null,
          2,
        )}\n`,
        "utf-8",
      );
      await fs.writeFile(
        path.join(configDir, "agent-defaults.json"),
        `${JSON.stringify({ model: "anthropic/sonnet-4.6" }, null, 2)}\n`,
        "utf-8",
      );

      await expect(
        mutateConfigFile({
          mutate: (draft) => {
            draft.agents = { defaults: { model: "openai/gpt-5.4" } };
          },
        }),
      ).rejects.toThrow(/flatten \$include-owned config/);
    });
  });
});
