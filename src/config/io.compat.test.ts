import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { applyRuntimeLegacyConfigMigrations } from "../commands/doctor/shared/runtime-compat-api.js";
import { createConfigIO } from "./io.js";
import { normalizeExecSafeBinProfilesInConfig } from "./normalize-exec-safe-bin.js";
import type { GenesisConfig } from "./types.genesis.js";

async function withTempHome(run: (home: string) => Promise<void>): Promise<void> {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "genesis-config-"));
  try {
    await run(home);
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
}

async function writeConfig(
  home: string,
  dirname: ".genesis",
  port: number,
  filename: string = "genesis.json",
) {
  const dir = path.join(home, dirname);
  await fs.mkdir(dir, { recursive: true });
  const configPath = path.join(dir, filename);
  await fs.writeFile(configPath, JSON.stringify({ gateway: { port } }, null, 2));
  return configPath;
}

function createIoForHome(home: string, env: NodeJS.ProcessEnv = {} as NodeJS.ProcessEnv) {
  return createConfigIO({
    env,
    homedir: () => home,
  });
}

describe("config io paths", () => {
  it("uses ~/.genesis/genesis.json when config exists", async () => {
    await withTempHome(async (home) => {
      const configPath = await writeConfig(home, ".genesis", 19001);
      const io = createIoForHome(home);
      expect(io.configPath).toBe(configPath);
    });
  });

  it("defaults to ~/.genesis/genesis.json when config is missing", async () => {
    await withTempHome(async (home) => {
      const io = createIoForHome(home);
      expect(io.configPath).toBe(path.join(home, ".genesis", "genesis.json"));
    });
  });

  it("uses GENESIS_HOME for default config path", async () => {
    await withTempHome(async (home) => {
      const io = createConfigIO({
        env: { GENESIS_HOME: path.join(home, "svc-home") } as NodeJS.ProcessEnv,
        homedir: () => path.join(home, "ignored-home"),
      });
      expect(io.configPath).toBe(path.join(home, "svc-home", ".genesis", "genesis.json"));
    });
  });

  it("honors explicit GENESIS_CONFIG_PATH override", async () => {
    await withTempHome(async (home) => {
      const customPath = await writeConfig(home, ".genesis", 20002, "custom.json");
      const io = createIoForHome(home, { GENESIS_CONFIG_PATH: customPath } as NodeJS.ProcessEnv);
      expect(io.configPath).toBe(customPath);
    });
  });

  it("logs validation warnings with real line breaks", async () => {
    await withTempHome(async (home) => {
      const configPath = path.join(home, ".genesis", "genesis.json");
      await fs.mkdir(path.dirname(configPath), { recursive: true });
      await fs.writeFile(
        configPath,
        JSON.stringify(
          {
            plugins: {
              entries: {
                "google-antigravity-auth": {
                  enabled: false,
                  config: { stale: true },
                },
              },
            },
          },
          null,
          2,
        ),
      );
      const logger = {
        error: vi.fn(),
        warn: vi.fn(),
      };

      const io = createConfigIO({
        configPath,
        env: {} as NodeJS.ProcessEnv,
        homedir: () => home,
        logger,
      });
      io.loadConfig();

      expect(logger.warn).toHaveBeenCalledWith(expect.stringMatching(/^Config warnings:\n- /));
      expect(logger.warn).not.toHaveBeenCalledWith(expect.stringContaining("Config warnings:\\n"));
    });
  });

  it("normalizes safe-bin config entries at config load time", async () => {
    const cfg = {
      tools: {
        exec: {
          safeBinTrustedDirs: [" /custom/bin ", "", "/custom/bin", "/agent/bin"],
          safeBinProfiles: {
            " MyFilter ": {
              allowedValueFlags: ["--limit", " --limit ", ""],
            },
          },
        },
      },
      agents: {
        list: [
          {
            id: "ops",
            tools: {
              exec: {
                safeBinTrustedDirs: [" /ops/bin ", "/ops/bin"],
                safeBinProfiles: {
                  " Custom ": {
                    deniedFlags: ["-f", " -f ", ""],
                  },
                },
              },
            },
          },
        ],
      },
    };
    normalizeExecSafeBinProfilesInConfig(cfg);
    expect(cfg.tools?.exec?.safeBinProfiles).toEqual({
      myfilter: {
        allowedValueFlags: ["--limit"],
      },
    });
    expect(cfg.tools?.exec?.safeBinTrustedDirs).toEqual(["/custom/bin", "/agent/bin"]);
    expect(cfg.agents?.list?.[0]?.tools?.exec?.safeBinProfiles).toEqual({
      custom: {
        deniedFlags: ["-f"],
      },
    });
    expect(cfg.agents?.list?.[0]?.tools?.exec?.safeBinTrustedDirs).toEqual(["/ops/bin"]);
  });

  it("moves WhatsApp shared access defaults into accounts.default during runtime compat", () => {
    const migrated = applyRuntimeLegacyConfigMigrations({
      channels: {
        whatsapp: {
          enabled: true,
          dmPolicy: "allowlist",
          allowFrom: ["+15550001111"],
          groupPolicy: "open",
          groupAllowFrom: [],
          accounts: {
            work: {
              enabled: true,
              authDir: "/tmp/wa-work",
            },
          },
        },
      },
    });
    const next = migrated.next as GenesisConfig | null;
    expect(next?.channels?.whatsapp?.accounts?.default).toMatchObject({
      dmPolicy: "allowlist",
      allowFrom: ["+15550001111"],
      groupPolicy: "open",
      groupAllowFrom: [],
    });
  });
});
