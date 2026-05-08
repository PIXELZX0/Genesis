import { describe, expect, it, vi } from "vitest";
import {
  applyConfigSnapshot,
  applyConfig,
  applyConfigRestartNow,
  cancelConfigRestartChanges,
  ensureAgentConfigEntry,
  findAgentConfigEntryIndex,
  getConfigRestartRequiredPaths,
  resetConfigPendingChanges,
  requestApplyConfig,
  runUpdate,
  saveConfig,
  saveConfigRestartLater,
  updateConfigFormValue,
  type ConfigState,
} from "./config.ts";

function createState(): ConfigState {
  return {
    applySessionKey: "main",
    client: null,
    configActiveSection: null,
    configActiveSubsection: null,
    configApplying: false,
    configForm: null,
    configFormDirty: false,
    configFormMode: "form",
    configFormOriginal: null,
    configRestartPrompt: null,
    configIssues: [],
    configLoading: false,
    configRaw: "",
    configRawOriginal: "",
    configSaving: false,
    configSchema: null,
    configSchemaLoading: false,
    configSchemaVersion: null,
    configSearchQuery: "",
    configSnapshot: null,
    configUiHints: {},
    configValid: null,
    connected: false,
    lastError: null,
    updateRunning: false,
  };
}

function createRequestWithConfigGet() {
  return vi.fn().mockImplementation(async (method: string) => {
    if (method === "config.get") {
      return { config: {}, valid: true, issues: [], raw: "{\n}\n" };
    }
    return {};
  });
}

describe("applyConfigSnapshot", () => {
  it("does not clobber form edits while dirty", () => {
    const state = createState();
    state.configFormMode = "form";
    state.configFormDirty = true;
    state.configForm = { gateway: { mode: "local", port: 18789 } };
    state.configRaw = "{\n}\n";

    applyConfigSnapshot(state, {
      config: { gateway: { mode: "remote", port: 9999 } },
      valid: true,
      issues: [],
      raw: '{\n  "gateway": { "mode": "remote", "port": 9999 }\n}\n',
    });

    expect(state.configRaw).toBe(
      '{\n  "gateway": {\n    "mode": "local",\n    "port": 18789\n  }\n}\n',
    );
  });

  it("updates config form when clean", () => {
    const state = createState();
    applyConfigSnapshot(state, {
      config: { gateway: { mode: "local" } },
      valid: true,
      issues: [],
      raw: "{}",
    });

    expect(state.configForm).toEqual({ gateway: { mode: "local" } });
  });

  it("sets configRawOriginal when clean for change detection", () => {
    const state = createState();
    applyConfigSnapshot(state, {
      config: { gateway: { mode: "local" } },
      valid: true,
      issues: [],
      raw: '{ "gateway": { "mode": "local" } }',
    });

    expect(state.configRawOriginal).toBe('{ "gateway": { "mode": "local" } }');
    expect(state.configFormOriginal).toEqual({ gateway: { mode: "local" } });
  });

  it("preserves configRawOriginal when dirty", () => {
    const state = createState();
    state.configFormDirty = true;
    state.configRawOriginal = '{ "original": true }';
    state.configFormOriginal = { original: true };

    applyConfigSnapshot(state, {
      config: { gateway: { mode: "local" } },
      valid: true,
      issues: [],
      raw: '{ "gateway": { "mode": "local" } }',
    });

    // Original values should be preserved when dirty
    expect(state.configRawOriginal).toBe('{ "original": true }');
    expect(state.configFormOriginal).toEqual({ original: true });
  });

  it("forces form mode when the snapshot does not include raw text", () => {
    const state = createState();
    state.configFormMode = "raw";

    applyConfigSnapshot(state, {
      config: { gateway: { mode: "local" } },
      valid: true,
      issues: [],
      raw: null,
    });

    expect(state.configFormMode).toBe("form");
    expect(state.configRaw).toBe('{\n  "gateway": {\n    "mode": "local"\n  }\n}\n');
  });
});

describe("updateConfigFormValue", () => {
  it("seeds from snapshot when form is null", () => {
    const state = createState();
    state.configSnapshot = {
      config: { channels: { telegram: { botToken: "t" } }, gateway: { mode: "local" } },
      valid: true,
      issues: [],
      raw: "{}",
    };

    updateConfigFormValue(state, ["gateway", "port"], 18789);

    expect(state.configFormDirty).toBe(true);
    expect(state.configForm).toEqual({
      channels: { telegram: { botToken: "t" } },
      gateway: { mode: "local", port: 18789 },
    });
  });

  it("keeps raw in sync while editing the form", () => {
    const state = createState();
    state.configSnapshot = {
      config: { gateway: { mode: "local" } },
      valid: true,
      issues: [],
      raw: "{\n}\n",
    };

    updateConfigFormValue(state, ["gateway", "port"], 18789);

    expect(state.configRaw).toBe(
      '{\n  "gateway": {\n    "mode": "local",\n    "port": 18789\n  }\n}\n',
    );
  });
});

describe("resetConfigPendingChanges", () => {
  it("restores the original form and raw config snapshot", () => {
    const state = createState();
    state.configSnapshot = {
      config: { gateway: { mode: "local" } },
      valid: true,
      issues: [],
      raw: '{\n  "gateway": { "mode": "local" }\n}\n',
    };
    state.configFormOriginal = { gateway: { mode: "local" } };
    state.configRawOriginal = '{\n  "gateway": { "mode": "local" }\n}\n';
    state.configForm = { gateway: { mode: "remote", port: 3000 } };
    state.configRaw = '{\n  "gateway": { "mode": "remote", "port": 3000 }\n}\n';
    state.configFormDirty = true;

    resetConfigPendingChanges(state);

    expect(state.configFormDirty).toBe(false);
    expect(state.configForm).toEqual({ gateway: { mode: "local" } });
    expect(state.configRaw).toBe('{\n  "gateway": { "mode": "local" }\n}\n');
  });

  it("preserves an intentionally empty original raw config", () => {
    const state = createState();
    state.configSnapshot = {
      config: {},
      valid: true,
      issues: [],
      raw: "",
    };
    state.configFormOriginal = {};
    state.configRawOriginal = "";
    state.configForm = { gateway: { mode: "remote" } };
    state.configRaw = '{\n  "gateway": { "mode": "remote" }\n}\n';
    state.configFormDirty = true;

    resetConfigPendingChanges(state);

    expect(state.configFormDirty).toBe(false);
    expect(state.configForm).toEqual({});
    expect(state.configRaw).toBe("");
  });
});

describe("agent config helpers", () => {
  it("finds explicit agent entries", () => {
    expect(
      findAgentConfigEntryIndex(
        {
          agents: {
            list: [{ id: "main" }, { id: "assistant" }],
          },
        },
        "assistant",
      ),
    ).toBe(1);
  });

  it("creates an agent override entry when editing an inherited agent", () => {
    const state = createState();
    state.configSnapshot = {
      config: {
        agents: {
          defaults: { model: "openai/gpt-5" },
        },
        tools: { profile: "messaging" },
      },
      valid: true,
      issues: [],
      raw: "{\n}\n",
    };

    const index = ensureAgentConfigEntry(state, "main");

    expect(index).toBe(0);
    expect(state.configFormDirty).toBe(true);
    expect(state.configForm).toEqual({
      agents: {
        defaults: { model: "openai/gpt-5" },
        list: [{ id: "main" }],
      },
      tools: { profile: "messaging" },
    });
  });

  it("reuses the existing agent entry instead of duplicating it", () => {
    const state = createState();
    state.configSnapshot = {
      config: {
        agents: {
          list: [{ id: "main", model: "openai/gpt-5" }],
        },
      },
      valid: true,
      issues: [],
      raw: "{\n}\n",
    };

    const index = ensureAgentConfigEntry(state, "main");

    expect(index).toBe(0);
    expect(state.configFormDirty).toBe(false);
    expect(state.configForm).toBeNull();
  });

  it("reuses an agent entry that already exists in the pending form state", () => {
    const state = createState();
    state.configSnapshot = {
      config: {},
      valid: true,
      issues: [],
      raw: "{\n}\n",
    };

    updateConfigFormValue(state, ["agents", "list", 0, "id"], "main");

    const index = ensureAgentConfigEntry(state, "main");

    expect(index).toBe(0);
    expect(state.configForm).toEqual({
      agents: {
        list: [{ id: "main" }],
      },
    });
  });
});

describe("applyConfig", () => {
  it("sends config.apply with raw and session key", async () => {
    const request = vi.fn().mockResolvedValue({});
    const state = createState();
    state.connected = true;
    state.client = { request } as unknown as ConfigState["client"];
    state.applySessionKey = "agent:main:whatsapp:dm:+15555550123";
    state.configFormMode = "raw";
    state.configRaw = '{\n  agent: { workspace: "~/genesis" }\n}\n';
    state.configSnapshot = {
      hash: "hash-123",
      raw: "{\n}\n",
    };

    await applyConfig(state);

    expect(request).toHaveBeenCalledWith("config.apply", {
      raw: '{\n  agent: { workspace: "~/genesis" }\n}\n',
      baseHash: "hash-123",
      sessionKey: "agent:main:whatsapp:dm:+15555550123",
    });
  });

  it("coerces schema-typed values before config.apply in form mode", async () => {
    const request = createRequestWithConfigGet();
    const state = createState();
    state.connected = true;
    state.client = { request } as unknown as ConfigState["client"];
    state.applySessionKey = "agent:main:web:dm:test";
    state.configFormMode = "form";
    state.configForm = {
      gateway: { port: "18789", debug: "true" },
    };
    state.configSchema = {
      type: "object",
      properties: {
        gateway: {
          type: "object",
          properties: {
            port: { type: "number" },
            debug: { type: "boolean" },
          },
        },
      },
    };
    state.configSnapshot = { hash: "hash-apply-1" };

    await applyConfig(state);

    expect(request.mock.calls[0]?.[0]).toBe("config.apply");
    const params = request.mock.calls[0]?.[1] as {
      raw: string;
      baseHash: string;
      sessionKey: string;
    };
    const parsed = JSON.parse(params.raw) as {
      gateway: { port: unknown; debug: unknown };
    };
    expect(typeof parsed.gateway.port).toBe("number");
    expect(parsed.gateway.port).toBe(18789);
    expect(parsed.gateway.debug).toBe(true);
    expect(params.baseHash).toBe("hash-apply-1");
    expect(params.sessionKey).toBe("agent:main:web:dm:test");
  });
});

describe("restart-required config changes", () => {
  it("detects form changes that require a gateway restart", () => {
    const state = createState();
    state.configSnapshot = {
      hash: "hash-restart-1",
      config: {
        gateway: { auth: { mode: "token" } },
        ui: { theme: "claw" },
      },
    };
    state.configFormOriginal = {
      gateway: { auth: { mode: "token" } },
      ui: { theme: "claw" },
    };
    state.configForm = {
      gateway: { auth: { mode: "password" } },
      ui: { theme: "dash" },
    };

    expect(getConfigRestartRequiredPaths(state)).toEqual(["gateway.auth.mode"]);
  });

  it("opens a restart prompt instead of applying immediately", async () => {
    const request = vi.fn().mockResolvedValue({});
    const state = createState();
    state.connected = true;
    state.client = { request } as unknown as ConfigState["client"];
    state.configSnapshot = {
      hash: "hash-restart-2",
      config: { gateway: { auth: { mode: "token" } } },
    };
    state.configFormOriginal = { gateway: { auth: { mode: "token" } } };
    state.configForm = { gateway: { auth: { mode: "password" } } };

    await requestApplyConfig(state);

    expect(request).not.toHaveBeenCalled();
    expect(state.configRestartPrompt).toEqual({ paths: ["gateway.auth.mode"] });
  });

  it("detects restart-required changes from raw JSON5 edits", async () => {
    const request = vi.fn().mockResolvedValue({});
    const state = createState();
    state.connected = true;
    state.client = { request } as unknown as ConfigState["client"];
    state.configFormMode = "raw";
    state.configSnapshot = {
      hash: "hash-restart-raw",
      raw: "{ gateway: { auth: { mode: 'token' } } }",
      config: { gateway: { auth: { mode: "token" } } },
    };
    state.configRaw = "{ gateway: { auth: { mode: 'password' } } }";

    await requestApplyConfig(state);

    expect(request).not.toHaveBeenCalled();
    expect(state.configRestartPrompt).toEqual({ paths: ["gateway.auth.mode"] });
  });

  it("lets restart prompt actions restart now, restart later, or cancel changes", async () => {
    const request = createRequestWithConfigGet();
    const state = createState();
    state.connected = true;
    state.client = { request } as unknown as ConfigState["client"];
    state.configSnapshot = {
      hash: "hash-restart-3",
      raw: "{}",
      config: { gateway: { auth: { mode: "token" } } },
    };
    state.configFormOriginal = { gateway: { auth: { mode: "token" } } };
    state.configForm = { gateway: { auth: { mode: "password" } } };
    state.configRestartPrompt = { paths: ["gateway.auth.mode"] };

    await applyConfigRestartNow(state);

    expect(request.mock.calls[0]?.[0]).toBe("config.apply");
    expect(state.configRestartPrompt).toBeNull();

    request.mockClear();
    state.configSnapshot = {
      hash: "hash-restart-4",
      raw: "{}",
      config: { gateway: { auth: { mode: "token" } } },
    };
    state.configFormOriginal = { gateway: { auth: { mode: "token" } } };
    state.configForm = { gateway: { auth: { mode: "password" } } };
    state.configRestartPrompt = { paths: ["gateway.auth.mode"] };

    await saveConfigRestartLater(state);

    expect(request.mock.calls[0]?.[0]).toBe("config.set");
    expect(state.configRestartPrompt).toBeNull();

    state.configSnapshot = {
      hash: "hash-restart-5",
      raw: "{}",
      config: { gateway: { auth: { mode: "token" } } },
    };
    state.configFormOriginal = { gateway: { auth: { mode: "token" } } };
    state.configForm = { gateway: { auth: { mode: "password" } } };
    state.configRestartPrompt = { paths: ["gateway.auth.mode"] };

    cancelConfigRestartChanges(state);

    expect(state.configRestartPrompt).toBeNull();
    expect(state.configForm).toEqual({ gateway: { auth: { mode: "token" } } });
    expect(state.configFormDirty).toBe(false);
  });
});

describe("saveConfig", () => {
  it("uses config.set snapshot responses without a follow-up config.get", async () => {
    const request = vi.fn().mockResolvedValue({
      hash: "hash-save-2",
      raw: '{\n  "gateway": {\n    "port": 18789\n  }\n}\n',
      config: { gateway: { port: 18789 } },
      valid: true,
      issues: [],
    });
    const state = createState();
    state.connected = true;
    state.client = { request } as unknown as ConfigState["client"];
    state.configFormMode = "form";
    state.configForm = { gateway: { port: "18789" } };
    state.configFormDirty = true;
    state.configSnapshot = { hash: "hash-save-1" };
    state.configSchema = {
      type: "object",
      properties: {
        gateway: {
          type: "object",
          properties: {
            port: { type: "number" },
          },
        },
      },
    };

    await saveConfig(state);

    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0]?.[0]).toBe("config.set");
    expect(state.configSnapshot?.hash).toBe("hash-save-2");
    expect(state.configFormDirty).toBe(false);
    expect(state.configFormOriginal).toEqual({ gateway: { port: 18789 } });
    expect(state.configRawOriginal).toBe('{\n  "gateway": {\n    "port": 18789\n  }\n}\n');
  });

  it("coerces schema-typed values before config.set in form mode", async () => {
    const request = createRequestWithConfigGet();
    const state = createState();
    state.connected = true;
    state.client = { request } as unknown as ConfigState["client"];
    state.configFormMode = "form";
    state.configForm = {
      gateway: { port: "18789", enabled: "false" },
    };
    state.configSchema = {
      type: "object",
      properties: {
        gateway: {
          type: "object",
          properties: {
            port: { type: "number" },
            enabled: { type: "boolean" },
          },
        },
      },
    };
    state.configSnapshot = { hash: "hash-save-1" };

    await saveConfig(state);

    expect(request.mock.calls[0]?.[0]).toBe("config.set");
    const params = request.mock.calls[0]?.[1] as { raw: string; baseHash: string };
    const parsed = JSON.parse(params.raw) as {
      gateway: { port: unknown; enabled: unknown };
    };
    expect(typeof parsed.gateway.port).toBe("number");
    expect(parsed.gateway.port).toBe(18789);
    expect(parsed.gateway.enabled).toBe(false);
    expect(params.baseHash).toBe("hash-save-1");
  });

  it("skips coercion when schema is not an object", async () => {
    const request = createRequestWithConfigGet();
    const state = createState();
    state.connected = true;
    state.client = { request } as unknown as ConfigState["client"];
    state.configFormMode = "form";
    state.configForm = {
      gateway: { port: "18789" },
    };
    state.configSchema = "invalid-schema";
    state.configSnapshot = { hash: "hash-save-2" };

    await saveConfig(state);

    expect(request.mock.calls[0]?.[0]).toBe("config.set");
    const params = request.mock.calls[0]?.[1] as { raw: string; baseHash: string };
    const parsed = JSON.parse(params.raw) as {
      gateway: { port: unknown };
    };
    expect(parsed.gateway.port).toBe("18789");
    expect(params.baseHash).toBe("hash-save-2");
  });
});

describe("runUpdate", () => {
  it("sends update.run with session key", async () => {
    const request = vi.fn().mockResolvedValue({});
    const state = createState();
    state.connected = true;
    state.client = { request } as unknown as ConfigState["client"];
    state.applySessionKey = "agent:main:whatsapp:dm:+15555550123";

    await runUpdate(state);

    expect(request).toHaveBeenCalledWith("update.run", {
      sessionKey: "agent:main:whatsapp:dm:+15555550123",
    });
  });

  it("surfaces update errors returned in response payload", async () => {
    const request = vi.fn().mockResolvedValue({
      ok: false,
      result: { status: "error", reason: "network unavailable" },
    });
    const state = createState();
    state.connected = true;
    state.client = { request } as unknown as ConfigState["client"];
    state.applySessionKey = "main";

    await runUpdate(state);

    expect(state.lastError).toBe("Update error: network unavailable");
  });
});
