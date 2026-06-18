import { describe, expect, it } from "vitest";
import type { GenesisConfig } from "../../../config/types.js";
import { LEGACY_CONFIG_MIGRATIONS } from "./legacy-config-migrations.js";

function migrateLegacyConfigForTest(raw: unknown): {
  config: GenesisConfig | null;
  changes: string[];
} {
  if (!raw || typeof raw !== "object") {
    return { config: null, changes: [] };
  }
  const next = structuredClone(raw) as Record<string, unknown>;
  const changes: string[] = [];
  for (const migration of LEGACY_CONFIG_MIGRATIONS) {
    migration.apply(next, changes);
  }
  return changes.length === 0
    ? { config: null, changes }
    : { config: next as GenesisConfig, changes };
}

describe("legacy migrate audio transcription", () => {
  it("does not rewrite removed routing.transcribeAudio migrations", () => {
    const res = migrateLegacyConfigForTest({
      routing: {
        transcribeAudio: {
          command: ["whisper", "--model", "base"],
          timeoutSeconds: 2,
        },
      },
    });

    expect(res.changes).toEqual([]);
    expect(res.config).toBeNull();
  });

  it("does not rewrite removed routing.transcribeAudio migrations when new config exists", () => {
    const res = migrateLegacyConfigForTest({
      routing: {
        transcribeAudio: {
          command: ["whisper", "--model", "tiny"],
        },
      },
      tools: {
        media: {
          audio: {
            models: [{ command: "existing", type: "cli" }],
          },
        },
      },
    });

    expect(res.changes).toEqual([]);
    expect(res.config).toBeNull();
  });

  it("drops invalid audio.transcription payloads", () => {
    const res = migrateLegacyConfigForTest({
      audio: {
        transcription: {
          command: [{}],
        },
      },
    });

    expect(res.changes).toContain("Removed audio.transcription (invalid or empty command).");
    expect(res.config?.audio).toBeUndefined();
    expect(res.config?.tools?.media?.audio).toBeUndefined();
  });
});

describe("legacy migrate mention routing", () => {
  it("does not rewrite removed routing.groupChat.requireMention migrations", () => {
    const res = migrateLegacyConfigForTest({
      routing: {
        groupChat: {
          requireMention: true,
        },
      },
    });

    expect(res.changes).toEqual([]);
    expect(res.config).toBeNull();
  });

  it("does not rewrite removed channels.telegram.requireMention migrations", () => {
    const res = migrateLegacyConfigForTest({
      channels: {
        telegram: {
          requireMention: false,
        },
      },
    });

    expect(res.changes).toEqual([]);
    expect(res.config).toBeNull();
  });
});

describe("legacy migrate sandbox scope aliases", () => {
  it("moves agents.defaults.sandbox.perSession into scope", () => {
    const res = migrateLegacyConfigForTest({
      agents: {
        defaults: {
          sandbox: {
            perSession: true,
          },
        },
      },
    });

    expect(res.changes).toContain(
      "Moved agents.defaults.sandbox.perSession → agents.defaults.sandbox.scope (session).",
    );
    expect(res.config?.agents?.defaults?.sandbox).toEqual({
      scope: "session",
    });
  });

  it("moves agents.list[].sandbox.perSession into scope", () => {
    const res = migrateLegacyConfigForTest({
      agents: {
        list: [
          {
            id: "pi",
            sandbox: {
              perSession: false,
            },
          },
        ],
      },
    });

    expect(res.changes).toContain(
      "Moved agents.list.0.sandbox.perSession → agents.list.0.sandbox.scope (shared).",
    );
    expect(res.config?.agents?.list?.[0]?.sandbox).toEqual({
      scope: "shared",
    });
  });

  it("drops legacy sandbox perSession when scope is already set", () => {
    const res = migrateLegacyConfigForTest({
      agents: {
        defaults: {
          sandbox: {
            scope: "agent",
            perSession: true,
          },
        },
      },
    });

    expect(res.changes).toContain(
      "Removed agents.defaults.sandbox.perSession (agents.defaults.sandbox.scope already set).",
    );
    expect(res.config?.agents?.defaults?.sandbox).toEqual({
      scope: "agent",
    });
  });

  it("does not migrate invalid sandbox perSession values", () => {
    const raw = {
      agents: {
        defaults: {
          sandbox: {
            perSession: "yes",
          },
        },
      },
    };

    const res = migrateLegacyConfigForTest(raw);

    expect(res.changes).toEqual([]);
    expect(res.config).toBeNull();
  });
});

describe("legacy migrate x_search auth", () => {
  it("moves only legacy x_search auth into plugin-owned xai config", () => {
    const res = migrateLegacyConfigForTest({
      tools: {
        web: {
          x_search: {
            apiKey: "xai-legacy-key",
            enabled: true,
            model: "grok-4-1-fast",
          },
        },
      },
    });

    expect((res.config?.tools?.web as Record<string, unknown> | undefined)?.x_search).toEqual({
      enabled: true,
      model: "grok-4-1-fast",
    });
    expect(res.config?.plugins?.entries?.xai).toEqual({
      enabled: true,
      config: {
        webSearch: {
          apiKey: "xai-legacy-key",
        },
      },
    });
    expect(res.changes).toEqual([
      "Moved tools.web.x_search.apiKey → plugins.entries.xai.config.webSearch.apiKey.",
    ]);
  });
});

describe("legacy migrate controlUi config", () => {
  it("seeds allowedOrigins for bind=lan with no existing controlUi config", () => {
    const res = migrateLegacyConfigForTest({
      gateway: {
        bind: "lan",
        auth: { mode: "token", token: "tok" },
      },
    });
    expect(res.config?.gateway?.controlUi?.allowedOrigins).toEqual([
      "http://localhost:18789",
      "http://127.0.0.1:18789",
    ]);
    expect(res.changes.some((c) => c.includes("gateway.controlUi.allowedOrigins"))).toBe(true);
    expect(res.changes.some((c) => c.includes("bind=lan"))).toBe(true);
  });

  it("seeds allowedOrigins using configured port", () => {
    const res = migrateLegacyConfigForTest({
      gateway: {
        bind: "lan",
        port: 9000,
        auth: { mode: "token", token: "tok" },
      },
    });
    expect(res.config?.gateway?.controlUi?.allowedOrigins).toEqual([
      "http://localhost:9000",
      "http://127.0.0.1:9000",
    ]);
  });

  it("seeds allowedOrigins including custom bind host for bind=custom", () => {
    const res = migrateLegacyConfigForTest({
      gateway: {
        bind: "custom",
        customBindHost: "192.168.1.100",
        auth: { mode: "token", token: "tok" },
      },
    });
    expect(res.config?.gateway?.controlUi?.allowedOrigins).toContain("http://192.168.1.100:18789");
    expect(res.config?.gateway?.controlUi?.allowedOrigins).toContain("http://localhost:18789");
  });

  it("does not overwrite existing allowedOrigins — returns null (no migration needed)", () => {
    // When allowedOrigins already exists, the migration is a no-op.
    // applyLegacyDoctorMigrations returns next=null when changes.length===0, so config is null.
    const res = migrateLegacyConfigForTest({
      gateway: {
        bind: "lan",
        auth: { mode: "token", token: "tok" },
        controlUi: { allowedOrigins: ["https://control.example.com"] },
      },
    });
    expect(res.config).toBeNull();
    expect(res.changes).toHaveLength(0);
  });

  it("does not migrate when dangerouslyAllowHostHeaderOriginFallback is set — returns null", () => {
    const res = migrateLegacyConfigForTest({
      gateway: {
        bind: "lan",
        auth: { mode: "token", token: "tok" },
        controlUi: { dangerouslyAllowHostHeaderOriginFallback: true },
      },
    });
    expect(res.config).toBeNull();
    expect(res.changes).toHaveLength(0);
  });

  it("seeds allowedOrigins when existing entries are blank strings", () => {
    const res = migrateLegacyConfigForTest({
      gateway: {
        bind: "lan",
        auth: { mode: "token", token: "tok" },
        controlUi: { allowedOrigins: ["", "   "] },
      },
    });
    expect(res.config?.gateway?.controlUi?.allowedOrigins).toEqual([
      "http://localhost:18789",
      "http://127.0.0.1:18789",
    ]);
    expect(res.changes.some((c) => c.includes("gateway.controlUi.allowedOrigins"))).toBe(true);
  });

  it("does not migrate loopback bind — returns null", () => {
    const res = migrateLegacyConfigForTest({
      gateway: {
        bind: "loopback",
        auth: { mode: "token", token: "tok" },
      },
    });
    expect(res.config).toBeNull();
    expect(res.changes).toHaveLength(0);
  });

  it("preserves existing controlUi fields when seeding allowedOrigins", () => {
    const res = migrateLegacyConfigForTest({
      gateway: {
        bind: "lan",
        auth: { mode: "token", token: "tok" },
        controlUi: { basePath: "/app" },
      },
    });
    expect(res.config?.gateway?.controlUi?.basePath).toBe("/app");
    expect(res.config?.gateway?.controlUi?.allowedOrigins).toEqual([
      "http://localhost:18789",
      "http://127.0.0.1:18789",
    ]);
  });
});
