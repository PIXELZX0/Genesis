import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GenesisConfig } from "../../config/types.genesis.js";
import type { RestartSentinelPayload } from "../../infra/restart-sentinel.js";
import {
  createConfigHandlerHarness,
  createConfigWriteSnapshot,
  flushConfigHandlerMicrotasks,
} from "./config.test-helpers.js";

const readConfigFileSnapshotForWriteMock = vi.fn();
const writeConfigFileMock = vi.fn();
const validateConfigObjectWithPluginsMock = vi.fn();
const prepareSecretsRuntimeSnapshotMock = vi.fn();
const scheduleGatewaySigusr1RestartMock = vi.fn(() => ({
  scheduled: true,
  delayMs: 1_000,
  coalesced: false,
}));
const restartSentinelMocks = vi.hoisted(() => ({
  writeRestartSentinel: vi.fn(async (_payload: RestartSentinelPayload) => {
    return "/tmp/restart-sentinel.json";
  }),
}));

vi.mock("../../config/config.js", async () => {
  const actual =
    await vi.importActual<typeof import("../../config/config.js")>("../../config/config.js");
  return {
    ...actual,
    createConfigIO: () => ({ configPath: "/tmp/genesis.json" }),
    readConfigFileSnapshotForWrite: readConfigFileSnapshotForWriteMock,
    validateConfigObjectWithPlugins: validateConfigObjectWithPluginsMock,
    writeConfigFile: writeConfigFileMock,
    writeConfigFileWithResult: writeConfigFileMock,
  };
});

vi.mock("../../config/runtime-schema.js", () => ({
  loadGatewayRuntimeConfigSchema: () => ({ uiHints: undefined }),
}));

vi.mock("../../secrets/runtime.js", () => ({
  prepareSecretsRuntimeSnapshot: prepareSecretsRuntimeSnapshotMock,
}));

vi.mock("../../infra/restart.js", () => ({
  scheduleGatewaySigusr1Restart: scheduleGatewaySigusr1RestartMock,
}));

vi.mock("../../infra/restart-sentinel.js", async () => {
  const actual = await vi.importActual<typeof import("../../infra/restart-sentinel.js")>(
    "../../infra/restart-sentinel.js",
  );
  return {
    ...actual,
    writeRestartSentinel: restartSentinelMocks.writeRestartSentinel,
  };
});

const { configHandlers } = await import("./config.js");

afterEach(() => {
  vi.clearAllMocks();
});

beforeEach(() => {
  validateConfigObjectWithPluginsMock.mockImplementation((config: GenesisConfig) => ({
    ok: true,
    config,
  }));
  prepareSecretsRuntimeSnapshotMock.mockResolvedValue(undefined);
  restartSentinelMocks.writeRestartSentinel.mockClear();
});

describe("config shared auth disconnects", () => {
  it("does not disconnect shared-auth clients for config.set auth writes without restart", async () => {
    const prevConfig: GenesisConfig = {
      gateway: {
        auth: {
          mode: "token",
          token: "old-token",
        },
      },
    };
    const nextConfig: GenesisConfig = {
      gateway: {
        auth: {
          mode: "token",
          token: "new-token",
        },
      },
    };
    readConfigFileSnapshotForWriteMock.mockResolvedValue(createConfigWriteSnapshot(prevConfig));

    const { options, disconnectClientsUsingSharedGatewayAuth } = createConfigHandlerHarness({
      method: "config.set",
      params: {
        raw: JSON.stringify(nextConfig, null, 2),
        baseHash: "base-hash",
      },
    });

    await configHandlers["config.set"](options);
    await flushConfigHandlerMicrotasks();

    expect(writeConfigFileMock).toHaveBeenCalledWith(
      nextConfig,
      expect.objectContaining({
        baseSnapshot: expect.any(Object),
        runtimeRefreshIncludeAuthStoreRefs: false,
      }),
    );
    expect(disconnectClientsUsingSharedGatewayAuth).not.toHaveBeenCalled();
    expect(scheduleGatewaySigusr1RestartMock).not.toHaveBeenCalled();
  });

  it("lets the config reloader own hybrid-mode auth restarts", async () => {
    const prevConfig: GenesisConfig = {
      gateway: {
        auth: {
          mode: "token",
          token: "old-token",
        },
      },
    };
    readConfigFileSnapshotForWriteMock.mockResolvedValue(createConfigWriteSnapshot(prevConfig));

    const { options, disconnectClientsUsingSharedGatewayAuth } = createConfigHandlerHarness({
      method: "config.patch",
      params: {
        baseHash: "base-hash",
        raw: JSON.stringify({ gateway: { auth: { token: "new-token" } } }),
        restartDelayMs: 1_000,
      },
    });

    await configHandlers["config.patch"](options);
    await flushConfigHandlerMicrotasks();

    expect(scheduleGatewaySigusr1RestartMock).not.toHaveBeenCalled();
    expect(disconnectClientsUsingSharedGatewayAuth).toHaveBeenCalledTimes(1);
  });

  it("disconnects shared-auth clients when config.apply rewrites SecretRef auth", async () => {
    const config: GenesisConfig = {
      gateway: {
        auth: {
          mode: "token",
          token: {
            source: "env",
            provider: "default",
            id: "GENESIS_GATEWAY_TOKEN_REF",
          },
        },
      },
    };
    readConfigFileSnapshotForWriteMock.mockResolvedValue(createConfigWriteSnapshot(config));

    const { options, disconnectClientsUsingSharedGatewayAuth } = createConfigHandlerHarness({
      method: "config.apply",
      params: {
        baseHash: "base-hash",
        raw: JSON.stringify(config, null, 2),
        restartDelayMs: 1_000,
      },
    });

    await configHandlers["config.apply"](options);
    await flushConfigHandlerMicrotasks();

    expect(disconnectClientsUsingSharedGatewayAuth).toHaveBeenCalledTimes(1);
  });

  it("does not disconnect shared-auth clients when config.patch changes only inactive password auth", async () => {
    const prevConfig: GenesisConfig = {
      gateway: {
        auth: {
          mode: "token",
          token: "old-token",
        },
      },
    };
    readConfigFileSnapshotForWriteMock.mockResolvedValue(createConfigWriteSnapshot(prevConfig));

    const { options, disconnectClientsUsingSharedGatewayAuth } = createConfigHandlerHarness({
      method: "config.patch",
      params: {
        baseHash: "base-hash",
        raw: JSON.stringify({ gateway: { auth: { password: "new-password" } } }),
        restartDelayMs: 1_000,
      },
    });

    await configHandlers["config.patch"](options);
    await flushConfigHandlerMicrotasks();

    expect(scheduleGatewaySigusr1RestartMock).not.toHaveBeenCalled();
    expect(disconnectClientsUsingSharedGatewayAuth).not.toHaveBeenCalled();
  });

  it("still schedules a direct restart for hot mode when the reloader cannot apply the change", async () => {
    const prevConfig: GenesisConfig = {
      gateway: {
        reload: {
          mode: "hot",
        },
      },
    };
    readConfigFileSnapshotForWriteMock.mockResolvedValue(createConfigWriteSnapshot(prevConfig));

    const { options } = createConfigHandlerHarness({
      method: "config.patch",
      params: {
        baseHash: "base-hash",
        raw: JSON.stringify({ gateway: { port: 19001 } }),
        restartDelayMs: 1_000,
      },
    });

    await configHandlers["config.patch"](options);
    await flushConfigHandlerMicrotasks();

    expect(scheduleGatewaySigusr1RestartMock).toHaveBeenCalledTimes(1);
  });

  it("does not schedule a direct restart for skills-only config.patch writes when reload mode is off", async () => {
    const prevConfig: GenesisConfig = {
      gateway: {
        reload: {
          mode: "off",
        },
      },
      skills: {
        entries: {
          github: {
            enabled: true,
          },
        },
      },
    };
    readConfigFileSnapshotForWriteMock.mockResolvedValue(createConfigWriteSnapshot(prevConfig));

    const { options } = createConfigHandlerHarness({
      method: "config.patch",
      params: {
        baseHash: "base-hash",
        raw: JSON.stringify({ skills: { entries: { github: { enabled: false } } } }),
        restartDelayMs: 1_000,
      },
    });

    await configHandlers["config.patch"](options);
    await flushConfigHandlerMicrotasks();

    expect(scheduleGatewaySigusr1RestartMock).not.toHaveBeenCalled();
  });

  it("does not schedule a direct restart for hot-safe model config.patch writes when reload mode is off", async () => {
    const prevConfig: GenesisConfig = {
      gateway: {
        reload: {
          mode: "off",
        },
      },
      agents: {
        defaults: {
          model: {
            primary: "openai/gpt-5.4",
          },
        },
      },
    };
    readConfigFileSnapshotForWriteMock.mockResolvedValue(createConfigWriteSnapshot(prevConfig));

    const { options } = createConfigHandlerHarness({
      method: "config.patch",
      params: {
        baseHash: "base-hash",
        raw: JSON.stringify({
          agents: {
            defaults: {
              model: {
                primary: "anthropic/claude-sonnet-4-6",
              },
            },
          },
        }),
        restartDelayMs: 1_000,
      },
    });

    await configHandlers["config.patch"](options);
    await flushConfigHandlerMicrotasks();

    expect(scheduleGatewaySigusr1RestartMock).not.toHaveBeenCalled();
  });

  it("still schedules a direct restart for restart-required config.patch writes when reload mode is off", async () => {
    const prevConfig: GenesisConfig = {
      gateway: {
        reload: {
          mode: "off",
        },
        port: 18789,
      },
    };
    readConfigFileSnapshotForWriteMock.mockResolvedValue(createConfigWriteSnapshot(prevConfig));

    const { options } = createConfigHandlerHarness({
      method: "config.patch",
      params: {
        baseHash: "base-hash",
        raw: JSON.stringify({ gateway: { port: 19001 } }),
        restartDelayMs: 1_000,
      },
    });

    await configHandlers["config.patch"](options);
    await flushConfigHandlerMicrotasks();

    expect(scheduleGatewaySigusr1RestartMock).toHaveBeenCalledTimes(1);
  });

  it("does not add an agent continuation from generic control-plane sessionKey params", async () => {
    const prevConfig: GenesisConfig = {
      gateway: {
        reload: {
          mode: "hot",
        },
      },
    };
    readConfigFileSnapshotForWriteMock.mockResolvedValue(createConfigWriteSnapshot(prevConfig));

    const { options } = createConfigHandlerHarness({
      method: "config.patch",
      params: {
        baseHash: "base-hash",
        raw: JSON.stringify({ gateway: { port: 19001 } }),
        restartDelayMs: 1_000,
        sessionKey: "agent:main:main",
      },
    });

    await configHandlers["config.patch"](options);

    expect(restartSentinelMocks.writeRestartSentinel).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionKey: "agent:main:main",
      }),
    );
    const payload = restartSentinelMocks.writeRestartSentinel.mock.calls.at(-1)?.[0];
    expect(payload?.continuation).toBeUndefined();
  });
});
