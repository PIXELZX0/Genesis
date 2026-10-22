import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AcpRuntime } from "../runtime-api.js";
import { AcpxRuntime } from "./runtime.js";

type TestSessionStore = {
  load(sessionId: string): Promise<Record<string, unknown> | undefined>;
  save(record: Record<string, unknown>): Promise<void>;
};

const DOCUMENTED_GENESIS_BRIDGE_COMMAND =
  "env GENESIS_HIDE_BANNER=1 GENESIS_SUPPRESS_NOTES=1 genesis acp --url ws://127.0.0.1:18789 --token-file ~/.genesis/gateway.token --session agent:main:main";

function makeRuntime(
  baseStore: TestSessionStore,
  options: Partial<ConstructorParameters<typeof AcpxRuntime>[0]> = {},
): {
  runtime: AcpxRuntime;
  wrappedStore: TestSessionStore & { markFresh: (sessionKey: string) => void };
  delegate: {
    close: AcpRuntime["close"];
    ensureSession: AcpRuntime["ensureSession"];
    getStatus: NonNullable<AcpRuntime["getStatus"]>;
    isHealthy(): boolean;
    probeAvailability(): Promise<void>;
  };
  bridgeSafeDelegate: {
    close: AcpRuntime["close"];
    ensureSession: AcpRuntime["ensureSession"];
    getStatus: NonNullable<AcpRuntime["getStatus"]>;
    isHealthy(): boolean;
    probeAvailability(): Promise<void>;
  };
} {
  const runtime = new AcpxRuntime({
    cwd: "/tmp",
    sessionStore: baseStore,
    agentRegistry: {
      resolve: (agentName: string) => (agentName === "genesis" ? "genesis acp" : agentName),
      list: () => ["codex", "genesis"],
    },
    permissionMode: "approve-reads",
    ...options,
  });

  return {
    runtime,
    wrappedStore: (
      runtime as unknown as {
        sessionStore: TestSessionStore & { markFresh: (sessionKey: string) => void };
      }
    ).sessionStore,
    delegate: (
      runtime as unknown as {
        delegate: {
          close: AcpRuntime["close"];
          ensureSession: AcpRuntime["ensureSession"];
          getStatus: NonNullable<AcpRuntime["getStatus"]>;
          isHealthy(): boolean;
          probeAvailability(): Promise<void>;
        };
      }
    ).delegate,
    bridgeSafeDelegate: (
      runtime as unknown as {
        bridgeSafeDelegate: {
          close: AcpRuntime["close"];
          ensureSession: AcpRuntime["ensureSession"];
          getStatus: NonNullable<AcpRuntime["getStatus"]>;
          isHealthy(): boolean;
          probeAvailability(): Promise<void>;
        };
      }
    ).bridgeSafeDelegate,
  };
}

describe("AcpxRuntime fresh reset wrapper", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps stale persistent loads hidden until a fresh record is saved", async () => {
    const baseStore: TestSessionStore = {
      load: vi.fn(async () => ({ acpxRecordId: "stale" }) as never),
      save: vi.fn(async () => {}),
    };

    const { runtime, wrappedStore } = makeRuntime(baseStore);

    expect(await wrappedStore.load("agent:codex:acp:binding:test")).toEqual({
      acpxRecordId: "stale",
    });
    expect(baseStore.load).toHaveBeenCalledTimes(1);

    await runtime.prepareFreshSession({
      sessionKey: "agent:codex:acp:binding:test",
    });

    expect(await wrappedStore.load("agent:codex:acp:binding:test")).toBeUndefined();
    expect(baseStore.load).toHaveBeenCalledTimes(1);
    expect(await wrappedStore.load("agent:codex:acp:binding:test")).toBeUndefined();
    expect(baseStore.load).toHaveBeenCalledTimes(1);

    await wrappedStore.save({
      acpxRecordId: "fresh-record",
      name: "agent:codex:acp:binding:test",
    } as never);

    expect(await wrappedStore.load("agent:codex:acp:binding:test")).toEqual({
      acpxRecordId: "stale",
    });
    expect(baseStore.load).toHaveBeenCalledTimes(2);
  });

  it("marks the session fresh after discardPersistentState close", async () => {
    const baseStore: TestSessionStore = {
      load: vi.fn(async () => ({ acpxRecordId: "stale" }) as never),
      save: vi.fn(async () => {}),
    };

    const { runtime, wrappedStore, delegate } = makeRuntime(baseStore);
    const close = vi.spyOn(delegate, "close").mockResolvedValue(undefined);

    await runtime.close({
      handle: {
        sessionKey: "agent:codex:acp:binding:test",
        backend: "acpx",
        runtimeSessionName: "agent:codex:acp:binding:test",
      },
      reason: "new-in-place-reset",
      discardPersistentState: true,
    });

    expect(close).toHaveBeenCalledWith({
      handle: {
        sessionKey: "agent:codex:acp:binding:test",
        backend: "acpx",
        runtimeSessionName: "agent:codex:acp:binding:test",
      },
      reason: "new-in-place-reset",
      discardPersistentState: true,
    });
    expect(await wrappedStore.load("agent:codex:acp:binding:test")).toBeUndefined();
    expect(baseStore.load).toHaveBeenCalledOnce();
  });

  it("routes genesis ensureSession through the bridge-safe delegate when MCP servers are configured", async () => {
    const baseStore: TestSessionStore = {
      load: vi.fn(async () => undefined),
      save: vi.fn(async () => {}),
    };

    const { runtime, delegate, bridgeSafeDelegate } = makeRuntime(baseStore, {
      mcpServers: [{ name: "tools", command: "mcp-tools" }] as never,
    });
    const defaultEnsure = vi.spyOn(delegate, "ensureSession").mockResolvedValue({
      sessionKey: "agent:codex:acp:test",
      backend: "acpx",
      runtimeSessionName: "default",
    });
    const bridgeEnsure = vi.spyOn(bridgeSafeDelegate, "ensureSession").mockResolvedValue({
      sessionKey: "agent:genesis:acp:test",
      backend: "acpx",
      runtimeSessionName: "bridge",
    });

    const result = await runtime.ensureSession({
      sessionKey: "agent:genesis:acp:test",
      agent: "genesis",
      mode: "persistent",
    });

    expect(result.runtimeSessionName).toBe("bridge");
    expect(bridgeEnsure).toHaveBeenCalledOnce();
    expect(defaultEnsure).not.toHaveBeenCalled();
  });

  it("reports the configured permission mode in capabilities", async () => {
    const baseStore: TestSessionStore = {
      load: vi.fn(async () => undefined),
      save: vi.fn(async () => {}),
    };
    const { runtime } = makeRuntime(baseStore);
    await expect(runtime.getCapabilities()).resolves.toMatchObject({
      permissionMode: "approve-reads",
    });
  });

  it("routes non-genesis sessions through the default delegate", async () => {
    const baseStore: TestSessionStore = {
      load: vi.fn(async () => undefined),
      save: vi.fn(async () => {}),
    };

    const { runtime, delegate, bridgeSafeDelegate } = makeRuntime(baseStore, {
      mcpServers: [{ name: "tools", command: "mcp-tools" }] as never,
    });
    const defaultEnsure = vi.spyOn(delegate, "ensureSession").mockResolvedValue({
      sessionKey: "agent:codex:acp:test",
      backend: "acpx",
      runtimeSessionName: "default",
    });
    const bridgeEnsure = vi.spyOn(bridgeSafeDelegate, "ensureSession").mockResolvedValue({
      sessionKey: "agent:genesis:acp:test",
      backend: "acpx",
      runtimeSessionName: "bridge",
    });

    const result = await runtime.ensureSession({
      sessionKey: "agent:codex:acp:test",
      agent: "codex",
      mode: "persistent",
    });

    expect(result.runtimeSessionName).toBe("default");
    expect(defaultEnsure).toHaveBeenCalledOnce();
    expect(bridgeEnsure).not.toHaveBeenCalled();
  });

  it("routes handle-based follow-up calls for genesis sessions through the bridge-safe delegate", async () => {
    const baseStore: TestSessionStore = {
      load: vi.fn(async () => undefined),
      save: vi.fn(async () => {}),
    };

    const { runtime, delegate, bridgeSafeDelegate } = makeRuntime(baseStore, {
      mcpServers: [{ name: "tools", command: "mcp-tools" }] as never,
    });
    const defaultStatus = vi.spyOn(delegate, "getStatus").mockResolvedValue({
      summary: "default",
    });
    const bridgeStatus = vi.spyOn(bridgeSafeDelegate, "getStatus").mockResolvedValue({
      summary: "bridge",
    });
    const handle: Parameters<NonNullable<AcpRuntime["getStatus"]>>[0]["handle"] = {
      sessionKey: "agent:genesis:acp:test",
      backend: "acpx",
      runtimeSessionName: "genesis-session-handle",
    };

    const status = await runtime.getStatus({ handle });

    expect(status.summary).toBe("bridge");
    expect(bridgeStatus).toHaveBeenCalledWith({ handle });
    expect(defaultStatus).not.toHaveBeenCalled();
  });

  it("keeps MCP-enabled routing when the genesis agent is overridden to a non-bridge adapter", async () => {
    const baseStore: TestSessionStore = {
      load: vi.fn(async () => undefined),
      save: vi.fn(async () => {}),
    };

    const { runtime, delegate, bridgeSafeDelegate } = makeRuntime(baseStore, {
      mcpServers: [{ name: "tools", command: "mcp-tools" }] as never,
      agentRegistry: {
        resolve: (agentName: string) => (agentName === "genesis" ? "codex" : agentName),
        list: () => ["codex", "genesis"],
      },
    });
    const defaultEnsure = vi.spyOn(delegate, "ensureSession").mockResolvedValue({
      sessionKey: "agent:genesis:acp:test",
      backend: "acpx",
      runtimeSessionName: "default",
    });
    const bridgeEnsure = vi.spyOn(bridgeSafeDelegate, "ensureSession").mockResolvedValue({
      sessionKey: "agent:genesis:acp:test",
      backend: "acpx",
      runtimeSessionName: "bridge",
    });

    const result = await runtime.ensureSession({
      sessionKey: "agent:genesis:acp:test",
      agent: "genesis",
      mode: "persistent",
    });

    expect(result.runtimeSessionName).toBe("default");
    expect(defaultEnsure).toHaveBeenCalledOnce();
    expect(bridgeEnsure).not.toHaveBeenCalled();
  });

  it("uses the bridge-safe delegate for any agent mapped to the genesis bridge command", async () => {
    const baseStore: TestSessionStore = {
      load: vi.fn(async () => undefined),
      save: vi.fn(async () => {}),
    };

    const { runtime, delegate, bridgeSafeDelegate } = makeRuntime(baseStore, {
      mcpServers: [{ name: "tools", command: "mcp-tools" }] as never,
      agentRegistry: {
        resolve: (agentName: string) => (agentName === "codex" ? "genesis acp" : agentName),
        list: () => ["codex", "genesis"],
      },
    });
    const defaultEnsure = vi.spyOn(delegate, "ensureSession").mockResolvedValue({
      sessionKey: "agent:codex:acp:test",
      backend: "acpx",
      runtimeSessionName: "default",
    });
    const bridgeEnsure = vi.spyOn(bridgeSafeDelegate, "ensureSession").mockResolvedValue({
      sessionKey: "agent:codex:acp:test",
      backend: "acpx",
      runtimeSessionName: "bridge",
    });

    const result = await runtime.ensureSession({
      sessionKey: "agent:codex:acp:test",
      agent: "codex",
      mode: "persistent",
    });

    expect(result.runtimeSessionName).toBe("bridge");
    expect(bridgeEnsure).toHaveBeenCalledOnce();
    expect(defaultEnsure).not.toHaveBeenCalled();
  });

  it("uses the bridge-safe delegate for documented env-wrapped genesis bridge commands", async () => {
    const baseStore: TestSessionStore = {
      load: vi.fn(async () => undefined),
      save: vi.fn(async () => {}),
    };

    const { runtime, delegate, bridgeSafeDelegate } = makeRuntime(baseStore, {
      mcpServers: [{ name: "tools", command: "mcp-tools" }] as never,
      agentRegistry: {
        resolve: (agentName: string) =>
          agentName === "genesis" ? DOCUMENTED_GENESIS_BRIDGE_COMMAND : agentName,
        list: () => ["codex", "genesis"],
      },
    });
    const defaultEnsure = vi.spyOn(delegate, "ensureSession").mockResolvedValue({
      sessionKey: "agent:genesis:acp:test",
      backend: "acpx",
      runtimeSessionName: "default",
    });
    const bridgeEnsure = vi.spyOn(bridgeSafeDelegate, "ensureSession").mockResolvedValue({
      sessionKey: "agent:genesis:acp:test",
      backend: "acpx",
      runtimeSessionName: "bridge",
    });

    const result = await runtime.ensureSession({
      sessionKey: "agent:genesis:acp:test",
      agent: "genesis",
      mode: "persistent",
    });

    expect(result.runtimeSessionName).toBe("bridge");
    expect(bridgeEnsure).toHaveBeenCalledOnce();
    expect(defaultEnsure).not.toHaveBeenCalled();
  });

  it("uses the bridge-safe delegate for local node genesis entrypoints", async () => {
    const baseStore: TestSessionStore = {
      load: vi.fn(async () => undefined),
      save: vi.fn(async () => {}),
    };

    const { runtime, delegate, bridgeSafeDelegate } = makeRuntime(baseStore, {
      mcpServers: [{ name: "tools", command: "mcp-tools" }] as never,
      agentRegistry: {
        resolve: (agentName: string) =>
          agentName === "genesis" ? "env GENESIS_HIDE_BANNER=1 node genesis.mjs acp" : agentName,
        list: () => ["codex", "genesis"],
      },
    });
    const defaultEnsure = vi.spyOn(delegate, "ensureSession").mockResolvedValue({
      sessionKey: "agent:genesis:acp:test",
      backend: "acpx",
      runtimeSessionName: "default",
    });
    const bridgeEnsure = vi.spyOn(bridgeSafeDelegate, "ensureSession").mockResolvedValue({
      sessionKey: "agent:genesis:acp:test",
      backend: "acpx",
      runtimeSessionName: "bridge",
    });

    const result = await runtime.ensureSession({
      sessionKey: "agent:genesis:acp:test",
      agent: "genesis",
      mode: "persistent",
    });

    expect(result.runtimeSessionName).toBe("bridge");
    expect(bridgeEnsure).toHaveBeenCalledOnce();
    expect(defaultEnsure).not.toHaveBeenCalled();
  });

  it("routes follow-up calls by persisted agent command before current config", async () => {
    const baseStore: TestSessionStore = {
      load: vi.fn(async () => ({
        acpxRecordId: "agent:genesis:acp:test",
        agentCommand: DOCUMENTED_GENESIS_BRIDGE_COMMAND,
      })),
      save: vi.fn(async () => {}),
    };

    const { runtime, delegate, bridgeSafeDelegate } = makeRuntime(baseStore, {
      mcpServers: [{ name: "tools", command: "mcp-tools" }] as never,
      agentRegistry: {
        resolve: (agentName: string) => (agentName === "genesis" ? "codex" : agentName),
        list: () => ["codex", "genesis"],
      },
    });
    const defaultStatus = vi.spyOn(delegate, "getStatus").mockResolvedValue({
      summary: "default",
    });
    const bridgeStatus = vi.spyOn(bridgeSafeDelegate, "getStatus").mockResolvedValue({
      summary: "bridge",
    });

    const status = await runtime.getStatus({
      handle: {
        sessionKey: "agent:genesis:acp:test",
        backend: "acpx",
        runtimeSessionName: "agent:genesis:acp:test",
      },
    });

    expect(status.summary).toBe("bridge");
    expect(bridgeStatus).toHaveBeenCalledOnce();
    expect(defaultStatus).not.toHaveBeenCalled();
  });

  it("probes through the bridge-safe delegate when probeAgent resolves to genesis bridge", async () => {
    const baseStore: TestSessionStore = {
      load: vi.fn(async () => undefined),
      save: vi.fn(async () => {}),
    };

    const { runtime, delegate, bridgeSafeDelegate } = makeRuntime(baseStore, {
      mcpServers: [{ name: "tools", command: "mcp-tools" }] as never,
      probeAgent: "genesis",
      agentRegistry: {
        resolve: (agentName: string) =>
          agentName === "genesis" ? DOCUMENTED_GENESIS_BRIDGE_COMMAND : agentName,
        list: () => ["codex", "genesis"],
      },
    });
    const defaultProbe = vi.spyOn(delegate, "probeAvailability").mockResolvedValue(undefined);
    const bridgeProbe = vi
      .spyOn(bridgeSafeDelegate, "probeAvailability")
      .mockResolvedValue(undefined);
    vi.spyOn(delegate, "isHealthy").mockReturnValue(false);
    vi.spyOn(bridgeSafeDelegate, "isHealthy").mockReturnValue(true);

    await runtime.probeAvailability();

    expect(runtime.isHealthy()).toBe(true);
    expect(bridgeProbe).toHaveBeenCalledOnce();
    expect(defaultProbe).not.toHaveBeenCalled();
  });
});

type FakeManagerOptions = { permissionMode?: unknown; mcpServers?: unknown[] };

// Fakes acpx's internal manager so tests see which permission mode each call ran under.
function makeModeTrackingRuntime(
  options: Partial<ConstructorParameters<typeof AcpxRuntime>[0]> = {},
) {
  const calls: Array<[method: string, permissionMode: unknown]> = [];
  const managers: FakeManagerOptions[] = [];
  const managerFactory = (managerOptions: FakeManagerOptions) => {
    managers.push(managerOptions);
    const track = (method: string) => {
      calls.push([method, managerOptions.permissionMode]);
    };
    return {
      ensureSession: async (input: { sessionKey: string; cwd: string }) => {
        track("ensureSession");
        return { acpxRecordId: input.sessionKey, acpSessionId: "backend-1", cwd: input.cwd };
      },
      runTurn: async function* () {
        track("runTurn");
        yield { type: "done" as const };
      },
      getStatus: async () => {
        track("getStatus");
        return { summary: "ok" };
      },
      close: async () => track("close"),
    };
  };
  const runtime = new AcpxRuntime(
    {
      cwd: "/tmp",
      sessionStore: { load: vi.fn(async () => undefined), save: vi.fn(async () => {}) },
      agentRegistry: {
        resolve: (agentName: string) => (agentName === "genesis" ? "genesis acp" : agentName),
        list: () => ["codex", "genesis"],
      },
      permissionMode: "approve-reads",
      ...options,
    },
    { managerFactory },
  );
  return { runtime, calls, managers };
}

describe("AcpxRuntime per-session permission mode", () => {
  const spawnInput = {
    sessionKey: "agent:codex:acp:spawn-1",
    agent: "codex",
    mode: "persistent" as const,
  };

  it("rejects a more permissive mode unless the operator allows escalation", async () => {
    const { runtime, calls } = makeModeTrackingRuntime();

    await expect(
      runtime.ensureSession({ ...spawnInput, permissionMode: "approve-all" }),
    ).rejects.toMatchObject({
      code: "ACP_INVALID_RUNTIME_OPTION",
      message: expect.stringContaining(
        "plugins.entries.acpx.config.allowSpawnPermissionEscalation",
      ),
    });
    expect(calls).toEqual([]);
  });

  it("rejects unknown permission modes", async () => {
    const { runtime } = makeModeTrackingRuntime({ allowSpawnPermissionEscalation: true });

    await expect(
      runtime.ensureSession({ ...spawnInput, permissionMode: "approve-everything" }),
    ).rejects.toMatchObject({ code: "ACP_INVALID_RUNTIME_OPTION" });
  });

  it("runs an allowed escalation and the session's follow-up calls under that mode", async () => {
    const { runtime, calls } = makeModeTrackingRuntime({ allowSpawnPermissionEscalation: true });

    const handle = await runtime.ensureSession({ ...spawnInput, permissionMode: "approve-all" });
    const events: unknown[] = [];
    for await (const event of runtime.runTurn({
      handle,
      text: "fix the tests",
      mode: "prompt",
      requestId: "req-1",
    })) {
      events.push(event);
    }
    await runtime.getStatus({ handle });
    await expect(runtime.getCapabilities({ handle })).resolves.toMatchObject({
      permissionMode: "approve-all",
    });
    await runtime.close({ handle, reason: "done" });

    expect(events).toEqual([{ type: "done" }]);
    expect(calls).toEqual([
      ["ensureSession", "approve-all"],
      ["runTurn", "approve-all"],
      ["getStatus", "approve-all"],
      ["close", "approve-all"],
    ]);
    // close releases the per-session entry; a reopened session is re-ensured with its mode.
    await expect(runtime.getCapabilities({ handle })).resolves.toMatchObject({
      permissionMode: "approve-reads",
    });
    await expect(runtime.getCapabilities()).resolves.toMatchObject({
      permissionMode: "approve-reads",
    });
  });

  it("always allows a less permissive mode", async () => {
    const { runtime, calls } = makeModeTrackingRuntime();

    const handle = await runtime.ensureSession({ ...spawnInput, permissionMode: "deny-all" });

    expect(calls).toEqual([["ensureSession", "deny-all"]]);
    await expect(runtime.getCapabilities({ handle })).resolves.toMatchObject({
      permissionMode: "deny-all",
    });
  });

  it("keeps sessions without a requested mode on the configured mode", async () => {
    const { runtime, calls, managers } = makeModeTrackingRuntime({
      allowSpawnPermissionEscalation: true,
    });

    const handle = await runtime.ensureSession(spawnInput);
    await runtime.getStatus({ handle });

    expect(calls).toEqual([
      ["ensureSession", "approve-reads"],
      ["getStatus", "approve-reads"],
    ]);
    expect(managers).toHaveLength(1);
    await expect(runtime.getCapabilities({ handle })).resolves.toMatchObject({
      permissionMode: "approve-reads",
    });
  });

  it("keeps the bridge-safe MCP split for per-mode delegates", async () => {
    const { runtime, managers } = makeModeTrackingRuntime({
      allowSpawnPermissionEscalation: true,
      mcpServers: [{ name: "tools", command: "mcp-tools" }] as never,
    });

    await runtime.ensureSession({
      sessionKey: "agent:genesis:acp:spawn-1",
      agent: "genesis",
      mode: "persistent",
      permissionMode: "approve-all",
    });
    await runtime.ensureSession({ ...spawnInput, permissionMode: "approve-all" });

    expect(managers).toEqual([
      expect.objectContaining({ permissionMode: "approve-all", mcpServers: [] }),
      expect.objectContaining({
        permissionMode: "approve-all",
        mcpServers: [{ name: "tools", command: "mcp-tools" }],
      }),
    ]);
  });
});
