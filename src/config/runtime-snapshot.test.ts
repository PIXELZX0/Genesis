import { afterEach, describe, expect, it, vi } from "vitest";
import { listAgentIds, resolveAgentConfig } from "../agents/agent-scope.js";
import {
  finalizeRuntimeSnapshotWrite,
  getRuntimeConfigSourceSnapshot,
  getRuntimeConfigSnapshot,
  loadPinnedRuntimeConfig,
  notifyRuntimeConfigWriteListeners,
  registerRuntimeConfigWriteListener,
  resetConfigRuntimeState,
  selectApplicableRuntimeConfig,
  setRuntimeConfigSnapshot,
  setRuntimeConfigSnapshotRefreshHandler,
  type RuntimeConfigWriteNotification,
} from "./runtime-snapshot.js";
import type { GenesisConfig } from "./types.js";

function resetRuntimeConfigState(): void {
  setRuntimeConfigSnapshotRefreshHandler(null);
  resetConfigRuntimeState();
}

describe("runtime snapshot state", () => {
  afterEach(() => {
    resetRuntimeConfigState();
  });

  it("pins the first successful load in memory until the snapshot is cleared", () => {
    let freshPort = 18789;
    let loadCount = 0;
    const loadFresh = (): GenesisConfig => {
      loadCount += 1;
      return { gateway: { port: freshPort } };
    };

    expect(loadPinnedRuntimeConfig(loadFresh).gateway?.port).toBe(18789);
    expect(loadCount).toBe(1);

    freshPort = 19001;
    expect(loadPinnedRuntimeConfig(loadFresh).gateway?.port).toBe(18789);
    expect(loadCount).toBe(1);

    resetRuntimeConfigState();
    expect(loadPinnedRuntimeConfig(loadFresh).gateway?.port).toBe(19001);
    expect(loadCount).toBe(2);
  });

  it("returns the source snapshot when runtime snapshot is active", () => {
    const sourceConfig: GenesisConfig = {
      models: {
        providers: {
          openai: {
            baseUrl: "https://api.openai.com/v1",
            apiKey: { source: "env", provider: "default", id: "OPENAI_API_KEY" },
            models: [],
          },
        },
      },
    };
    const runtimeConfig: GenesisConfig = {
      models: {
        providers: {
          openai: {
            baseUrl: "https://api.openai.com/v1",
            apiKey: "sk-runtime-resolved",
            models: [],
          },
        },
      },
    };

    setRuntimeConfigSnapshot(runtimeConfig, sourceConfig);
    expect(getRuntimeConfigSourceSnapshot()).toEqual(sourceConfig);
  });

  it("selects runtime config only when input still matches the runtime source", () => {
    const sourceConfig: GenesisConfig = {
      models: {
        providers: {
          openai: {
            baseUrl: "https://api.openai.com/v1",
            apiKey: { source: "env", provider: "default", id: "OPENAI_API_KEY" },
            models: [],
          },
        },
      },
    };
    const runtimeConfig: GenesisConfig = {
      models: {
        providers: {
          openai: {
            baseUrl: "https://api.openai.com/v1",
            apiKey: "sk-runtime-resolved",
            models: [],
          },
        },
      },
    };
    const scopedResolvedConfig: GenesisConfig = {
      ...runtimeConfig,
      tools: {
        experimental: {
          planTool: true,
        },
      },
    };

    expect(
      selectApplicableRuntimeConfig({
        inputConfig: structuredClone(sourceConfig),
        runtimeConfig,
        runtimeSourceConfig: sourceConfig,
      }),
    ).toBe(runtimeConfig);
    expect(
      selectApplicableRuntimeConfig({
        inputConfig: scopedResolvedConfig,
        runtimeConfig,
        runtimeSourceConfig: sourceConfig,
      }),
    ).toBe(scopedResolvedConfig);
  });

  it("clears runtime source snapshot when runtime snapshot is cleared", () => {
    setRuntimeConfigSnapshot({ gateway: { port: 18789 } }, { gateway: { port: 18789 } });
    resetRuntimeConfigState();
    expect(getRuntimeConfigSnapshot()).toBeNull();
    expect(getRuntimeConfigSourceSnapshot()).toBeNull();
  });

  it("refreshes both snapshots from disk after a write when source + runtime snapshots exist", async () => {
    const notifyCommittedWrite = vi.fn();
    const loadFreshConfig = vi.fn<() => GenesisConfig>(() => ({
      gateway: { auth: { mode: "token" } },
    }));
    const nextSourceConfig: GenesisConfig = {
      gateway: { auth: { mode: "token" } },
      models: {
        providers: {
          openai: {
            baseUrl: "https://api.openai.com/v1",
            apiKey: { source: "env", provider: "default", id: "OPENAI_API_KEY" },
            models: [],
          },
        },
      },
    };

    setRuntimeConfigSnapshot(
      {
        models: {
          providers: {
            openai: {
              baseUrl: "https://api.openai.com/v1",
              apiKey: "sk-runtime-resolved",
              models: [],
            },
          },
        },
      },
      nextSourceConfig,
    );

    await finalizeRuntimeSnapshotWrite({
      nextSourceConfig,
      hadRuntimeSnapshot: true,
      hadBothSnapshots: true,
      loadFreshConfig,
      notifyCommittedWrite,
      formatRefreshError: (error) => String(error),
      createRefreshError: (detail, cause) => new Error(detail, { cause }),
    });

    expect(loadFreshConfig).toHaveBeenCalledTimes(1);
    expect(getRuntimeConfigSnapshot()).toEqual({ gateway: { auth: { mode: "token" } } });
    expect(getRuntimeConfigSourceSnapshot()).toEqual(nextSourceConfig);
    expect(notifyCommittedWrite).toHaveBeenCalledTimes(1);
  });

  it("refreshes a plain runtime snapshot after writes without restoring a source snapshot", async () => {
    const notifyCommittedWrite = vi.fn();
    const loadFreshConfig = vi.fn(() => ({ gateway: { port: 19002 } }));

    setRuntimeConfigSnapshot({ gateway: { port: 18789 } });

    await finalizeRuntimeSnapshotWrite({
      nextSourceConfig: { gateway: { port: 19002 } },
      hadRuntimeSnapshot: true,
      hadBothSnapshots: false,
      loadFreshConfig,
      notifyCommittedWrite,
      formatRefreshError: (error) => String(error),
      createRefreshError: (detail, cause) => new Error(detail, { cause }),
    });

    expect(loadFreshConfig).toHaveBeenCalledTimes(1);
    expect(getRuntimeConfigSnapshot()).toEqual({ gateway: { port: 19002 } });
    expect(getRuntimeConfigSourceSnapshot()).toBeNull();
    expect(notifyCommittedWrite).toHaveBeenCalledTimes(1);
  });

  it("publishes the refreshed agents.list snapshot to consumers after a committed write", async () => {
    const oldRuntimeConfig: GenesisConfig = {
      agents: {
        list: [{ id: "main", workspace: "/tmp/main", model: "openai/old" }],
      },
    };
    const oldSourceConfig: GenesisConfig = structuredClone(oldRuntimeConfig);
    const nextRuntimeConfig: GenesisConfig = {
      agents: {
        list: [
          { id: "main", workspace: "/tmp/main", model: "openai/new" },
          { id: "persistent", workspace: "/tmp/persistent", model: "openai/new" },
        ],
      },
    };
    const nextSourceConfig: GenesisConfig = structuredClone(nextRuntimeConfig);
    const committedWrites: RuntimeConfigWriteNotification[] = [];
    const unsubscribe = registerRuntimeConfigWriteListener((event) => {
      committedWrites.push(event);
    });

    setRuntimeConfigSnapshot(oldRuntimeConfig, oldSourceConfig);
    expect(getRuntimeConfigSnapshot()).toBe(oldRuntimeConfig);
    expect(getRuntimeConfigSourceSnapshot()).toBe(oldSourceConfig);

    try {
      await finalizeRuntimeSnapshotWrite({
        nextSourceConfig,
        hadRuntimeSnapshot: true,
        hadBothSnapshots: true,
        loadFreshConfig: vi.fn(() => nextRuntimeConfig),
        notifyCommittedWrite: () => {
          const runtimeConfig = getRuntimeConfigSnapshot();
          if (!runtimeConfig) {
            throw new Error("runtime snapshot missing after committed write");
          }
          notifyRuntimeConfigWriteListeners({
            configPath: "/tmp/genesis.json",
            sourceConfig: nextSourceConfig,
            runtimeConfig,
            persistedHash: "next-agents-list",
            writtenAtMs: 1,
          });
        },
        formatRefreshError: (error) => String(error),
        createRefreshError: (detail, cause) => new Error(detail, { cause }),
      });
    } finally {
      unsubscribe();
    }

    expect(committedWrites).toHaveLength(1);
    expect(committedWrites[0]?.runtimeConfig.agents?.list).toEqual(nextRuntimeConfig.agents?.list);
    expect(getRuntimeConfigSnapshot()).toBe(nextRuntimeConfig);

    const runtimeSnapshot = getRuntimeConfigSnapshot();
    expect(runtimeSnapshot).not.toBeNull();
    expect(listAgentIds(runtimeSnapshot!)).toEqual(["main", "persistent"]);
    expect(resolveAgentConfig(runtimeSnapshot!, "main")?.model).toBe("openai/new");
    expect(resolveAgentConfig(runtimeSnapshot!, "persistent")).toMatchObject({
      workspace: "/tmp/persistent",
      model: "openai/new",
    });
  });

  it("keeps the last-known-good runtime snapshot active while specialized refresh is pending", async () => {
    const notifyCommittedWrite = vi.fn();
    const loadFreshConfig = vi.fn<() => GenesisConfig>(() => ({
      gateway: { auth: { mode: "token" } },
    }));
    let releaseRefresh!: () => void;
    const refreshPending = new Promise<boolean>((resolve) => {
      releaseRefresh = () => resolve(true);
    });

    setRuntimeConfigSnapshot(
      {
        models: {
          providers: {
            openai: {
              baseUrl: "https://api.openai.com/v1",
              apiKey: "sk-runtime-resolved",
              models: [],
            },
          },
        },
      },
      {
        models: {
          providers: {
            openai: {
              baseUrl: "https://api.openai.com/v1",
              apiKey: { source: "env", provider: "default", id: "OPENAI_API_KEY" },
              models: [],
            },
          },
        },
      },
    );
    setRuntimeConfigSnapshotRefreshHandler({
      refresh: async ({ sourceConfig }) => {
        expect(sourceConfig.gateway?.auth).toEqual({ mode: "token" });
        expect(getRuntimeConfigSnapshot()?.gateway?.auth).toBeUndefined();
        return await refreshPending;
      },
    });

    const writePromise = finalizeRuntimeSnapshotWrite({
      nextSourceConfig: {
        gateway: { auth: { mode: "token" } },
        models: {
          providers: {
            openai: {
              baseUrl: "https://api.openai.com/v1",
              apiKey: { source: "env", provider: "default", id: "OPENAI_API_KEY" },
              models: [],
            },
          },
        },
      },
      hadRuntimeSnapshot: true,
      hadBothSnapshots: true,
      loadFreshConfig,
      notifyCommittedWrite,
      formatRefreshError: (error) => String(error),
      createRefreshError: (detail, cause) => new Error(detail, { cause }),
    });

    await Promise.resolve();
    expect(getRuntimeConfigSnapshot()?.gateway?.auth).toBeUndefined();
    expect(loadFreshConfig).not.toHaveBeenCalled();

    releaseRefresh();
    await writePromise;

    expect(notifyCommittedWrite).toHaveBeenCalledTimes(1);
  });

  it("notifies registered write listeners with committed runtime snapshots", () => {
    const seen: Array<{ configPath: string; runtimeConfig: GenesisConfig }> = [];
    const unsubscribe = registerRuntimeConfigWriteListener((event) => {
      seen.push({
        configPath: event.configPath,
        runtimeConfig: event.runtimeConfig,
      });
    });

    try {
      notifyRuntimeConfigWriteListeners({
        configPath: "/tmp/genesis.json",
        sourceConfig: { gateway: { port: 18789 } },
        runtimeConfig: { gateway: { port: 19003 } },
        persistedHash: "abc123",
        writtenAtMs: 1,
      });
    } finally {
      unsubscribe();
    }

    expect(seen).toEqual([
      {
        configPath: "/tmp/genesis.json",
        runtimeConfig: { gateway: { port: 19003 } },
      },
    ]);
  });
});
