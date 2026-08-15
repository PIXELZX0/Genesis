// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GATEWAY_EVENT_UPDATE_AVAILABLE } from "../../../src/gateway/events.js";
import { ConnectErrorDetailCodes } from "../../../src/gateway/protocol/connect-error-details.js";
import { PROTOCOL_VERSION as GATEWAY_PROTOCOL_VERSION } from "../../../src/gateway/protocol/version.js";
import { connectGateway, resolveControlUiClientVersion } from "./app-gateway.ts";
import type { ChatHistoryLoadResult } from "./controllers/chat.ts";
import type { GatewayHelloOk } from "./gateway.ts";

const loadChatHistoryMock = vi.hoisted(() =>
  vi.fn(async (): Promise<ChatHistoryLoadResult> => "applied"),
);
const invalidateChatHistoryRequestsMock = vi.hoisted(() => vi.fn());
const loadControlUiBootstrapConfigMock = vi.hoisted(() => vi.fn(async () => undefined));

type GatewayClientMock = {
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  request: ReturnType<typeof vi.fn>;
  options: { clientVersion?: string };
  emitHello: (hello?: GatewayHelloOk) => void;
  emitClose: (info: {
    code: number;
    reason?: string;
    error?: { code: string; message: string; details?: unknown };
  }) => void;
  emitGap: (expected: number, received: number) => void;
  emitEvent: (evt: { event: string; payload?: unknown; seq?: number }) => void;
};

const gatewayClientInstances: GatewayClientMock[] = [];

vi.mock("./gateway.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./gateway.ts")>();

  function resolveGatewayErrorDetailCode(
    error: { details?: unknown } | null | undefined,
  ): string | null {
    const details = error?.details;
    if (!details || typeof details !== "object") {
      return null;
    }
    const code = (details as { code?: unknown }).code;
    return typeof code === "string" ? code : null;
  }

  class GatewayBrowserClient {
    readonly start = vi.fn();
    readonly stop = vi.fn();
    readonly request = vi.fn(async (method: string) => {
      if (method === "models.authStatus") {
        return { ts: 0, providers: [] };
      }
      return {};
    });

    constructor(
      private opts: {
        clientVersion?: string;
        onHello?: (hello: GatewayHelloOk) => void;
        onClose?: (info: {
          code: number;
          reason: string;
          error?: { code: string; message: string; details?: unknown };
        }) => void;
        onGap?: (info: { expected: number; received: number }) => void;
        onEvent?: (evt: { event: string; payload?: unknown; seq?: number }) => void;
      },
    ) {
      gatewayClientInstances.push({
        start: this.start,
        stop: this.stop,
        request: this.request,
        options: { clientVersion: this.opts.clientVersion },
        emitHello: (hello) => {
          this.opts.onHello?.(
            hello ?? {
              type: "hello-ok",
              protocol: GATEWAY_PROTOCOL_VERSION,
              snapshot: {},
            },
          );
        },
        emitClose: (info) => {
          this.opts.onClose?.({
            code: info.code,
            reason: info.reason ?? "",
            error: info.error,
          });
        },
        emitGap: (expected, received) => {
          this.opts.onGap?.({ expected, received });
        },
        emitEvent: (evt) => {
          this.opts.onEvent?.(evt);
        },
      });
    }
  }

  return { ...actual, GatewayBrowserClient, resolveGatewayErrorDetailCode };
});

vi.mock("./controllers/chat.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./controllers/chat.ts")>();
  return {
    ...actual,
    invalidateChatHistoryRequests: invalidateChatHistoryRequestsMock,
    loadChatHistory: loadChatHistoryMock,
  };
});

vi.mock("./controllers/control-ui-bootstrap.ts", () => ({
  loadControlUiBootstrapConfig: loadControlUiBootstrapConfigMock,
}));

type TestGatewayHost = Parameters<typeof connectGateway>[0] & {
  chatSideResult: unknown;
  chatSideResultTerminalRuns: Set<string>;
  chatMessages: unknown[];
  chatQueue: Array<{ id: string; text: string; createdAt: number }>;
  chatSending: boolean;
  chatStream: string | null;
  updateComplete: Promise<unknown>;
  chatToolMessages: Record<string, unknown>[];
  toolStreamById: Map<string, unknown>;
  toolStreamOrder: string[];
};

type AgentBackedTestHost = ReturnType<typeof createHost> & {
  memoryLoading: boolean;
  memoryLoadingAgentId: string | null;
  memoryLoadedAgentId: string | null;
  memoryLoadRequestId: number;
  memoryError: string | null;
  contactsLoading: boolean;
  contactsLoadingAgentId: string | null;
  contactsLoadedAgentId: string | null;
  contactsLoadRequestId: number;
  contactsError: string | null;
  memoryGraphLoading: boolean;
  memoryGraphLoadingAgentId: string | null;
  memoryGraphLoadedAgentId: string | null;
  memoryGraphLoadRequestId: number;
  memoryGraphError: string | null;
};

function createHost(): TestGatewayHost {
  return {
    settings: {
      gatewayUrl: "ws://127.0.0.1:18789",
      token: "",
      sessionKey: "main",
      lastActiveSessionKey: "main",
      theme: "system",
      chatFocusMode: false,
      chatShowThinking: true,
      splitRatio: 0.6,
      navCollapsed: false,
      navGroupsCollapsed: {},
      borderRadius: 50,
    },
    password: "",
    clientInstanceId: "instance-test",
    client: null,
    connected: false,
    hello: null,
    lastError: null,
    lastErrorCode: null,
    eventLogBuffer: [],
    eventLog: [],
    tab: "overview",
    presenceEntries: [],
    presenceError: null,
    presenceStatus: null,
    agentsLoading: false,
    agentsList: null,
    agentsError: null,
    debugHealth: null,
    assistantName: "Genesis",
    assistantAvatar: null,
    assistantAgentId: null,
    localMediaPreviewRoots: [],
    serverVersion: null,
    sessionKey: "main",
    chatMessages: [],
    chatQueue: [],
    chatToolMessages: [],
    chatStreamSegments: [],
    chatStream: null,
    chatStreamStartedAt: null,
    updateComplete: Promise.resolve(),
    chatRunId: null,
    chatSideResult: null,
    chatSending: false,
    toolStreamById: new Map(),
    toolStreamOrder: [],
    toolStreamSyncTimer: null,
    refreshSessionsAfterChat: new Set<string>(),
    chatSideResultTerminalRuns: new Set<string>(),
    execApprovalQueue: [],
    execApprovalError: null,
    updateAvailable: null,
  } as unknown as TestGatewayHost;
}

function connectHostGateway() {
  const host = createHost();
  connectGateway(host);
  const client = gatewayClientInstances[0];
  expect(client).toBeDefined();
  return { host, client };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function emitToolResultEvent(client: GatewayClientMock) {
  client.emitEvent({
    event: "agent",
    payload: {
      runId: "engine-run-1",
      seq: 1,
      stream: "tool",
      ts: 1,
      sessionKey: "main",
      data: {
        toolCallId: "tool-1",
        name: "fetch",
        phase: "result",
        result: { text: "ok" },
      },
    },
  });
}

describe("connectGateway", () => {
  beforeEach(() => {
    gatewayClientInstances.length = 0;
    loadChatHistoryMock.mockClear();
    invalidateChatHistoryRequestsMock.mockClear();
    loadControlUiBootstrapConfigMock.mockClear();
    vi.stubGlobal("window", {
      setTimeout: globalThis.setTimeout,
    });
  });

  it("ignores stale client onGap callbacks after reconnect", () => {
    const host = createHost();

    connectGateway(host);
    const firstClient = gatewayClientInstances[0];
    expect(firstClient).toBeDefined();

    connectGateway(host);
    const secondClient = gatewayClientInstances[1];
    expect(secondClient).toBeDefined();

    firstClient.emitGap(10, 13);
    expect(host.lastError).toBeNull();

    secondClient.emitGap(20, 24);
    expect(gatewayClientInstances).toHaveLength(3);
    expect(secondClient.stop).toHaveBeenCalledTimes(1);
    expect(host.lastError).toBeNull();
  });

  it("resets agent-backed load markers when starting a new connection", () => {
    const host = createHost() as AgentBackedTestHost;
    host.memoryLoading = true;
    host.memoryLoadingAgentId = "assistant";
    host.memoryLoadedAgentId = "assistant";
    host.memoryLoadRequestId = 4;
    host.memoryError = "memory failed";
    host.contactsLoading = true;
    host.contactsLoadingAgentId = "assistant";
    host.contactsLoadedAgentId = "assistant";
    host.contactsLoadRequestId = 7;
    host.contactsError = "contacts failed";
    host.memoryGraphLoading = true;
    host.memoryGraphLoadingAgentId = "assistant";
    host.memoryGraphLoadedAgentId = "assistant";
    host.memoryGraphLoadRequestId = 10;
    host.memoryGraphError = "graph failed";

    connectGateway(host);

    expect(host.memoryLoading).toBe(false);
    expect(host.memoryLoadingAgentId).toBeNull();
    expect(host.memoryLoadedAgentId).toBeNull();
    expect(host.memoryLoadRequestId).toBe(5);
    expect(host.memoryError).toBeNull();
    expect(host.contactsLoading).toBe(false);
    expect(host.contactsLoadingAgentId).toBeNull();
    expect(host.contactsLoadedAgentId).toBeNull();
    expect(host.contactsLoadRequestId).toBe(8);
    expect(host.contactsError).toBeNull();
    expect(host.memoryGraphLoading).toBe(false);
    expect(host.memoryGraphLoadingAgentId).toBeNull();
    expect(host.memoryGraphLoadedAgentId).toBeNull();
    expect(host.memoryGraphLoadRequestId).toBe(11);
    expect(host.memoryGraphError).toBeNull();
  });

  it("resets agent-backed load markers when the active client closes", () => {
    const host = createHost() as AgentBackedTestHost;
    connectGateway(host);
    const client = gatewayClientInstances[0];
    expect(client).toBeDefined();

    host.memoryLoading = true;
    host.memoryLoadingAgentId = "assistant";
    host.memoryLoadedAgentId = "assistant";
    host.memoryLoadRequestId = 4;
    host.memoryError = "memory failed";
    host.contactsLoading = true;
    host.contactsLoadingAgentId = "assistant";
    host.contactsLoadedAgentId = "assistant";
    host.contactsLoadRequestId = 7;
    host.contactsError = "contacts failed";
    host.memoryGraphLoading = true;
    host.memoryGraphLoadingAgentId = "assistant";
    host.memoryGraphLoadedAgentId = "assistant";
    host.memoryGraphLoadRequestId = 10;
    host.memoryGraphError = "graph failed";

    client.emitClose({ code: 1006 });

    expect(host.memoryLoading).toBe(false);
    expect(host.memoryLoadingAgentId).toBeNull();
    expect(host.memoryLoadedAgentId).toBeNull();
    expect(host.memoryLoadRequestId).toBe(5);
    expect(host.memoryError).toBeNull();
    expect(host.contactsLoading).toBe(false);
    expect(host.contactsLoadingAgentId).toBeNull();
    expect(host.contactsLoadedAgentId).toBeNull();
    expect(host.contactsLoadRequestId).toBe(8);
    expect(host.contactsError).toBeNull();
    expect(host.memoryGraphLoading).toBe(false);
    expect(host.memoryGraphLoadingAgentId).toBeNull();
    expect(host.memoryGraphLoadedAgentId).toBeNull();
    expect(host.memoryGraphLoadRequestId).toBe(11);
    expect(host.memoryGraphError).toBeNull();
  });

  it("ignores stale client onEvent callbacks after reconnect", () => {
    const host = createHost();

    connectGateway(host);
    const firstClient = gatewayClientInstances[0];
    expect(firstClient).toBeDefined();

    connectGateway(host);
    const secondClient = gatewayClientInstances[1];
    expect(secondClient).toBeDefined();

    firstClient.emitEvent({ event: "presence", payload: { presence: [{ host: "stale" }] } });
    expect(host.eventLogBuffer).toHaveLength(0);

    secondClient.emitEvent({ event: "presence", payload: { presence: [{ host: "active" }] } });
    expect(host.eventLogBuffer).toHaveLength(1);
    expect(host.eventLogBuffer[0]?.event).toBe("presence");
  });

  it("applies update.available only from active client", () => {
    const host = createHost();

    connectGateway(host);
    const firstClient = gatewayClientInstances[0];
    expect(firstClient).toBeDefined();

    connectGateway(host);
    const secondClient = gatewayClientInstances[1];
    expect(secondClient).toBeDefined();

    firstClient.emitEvent({
      event: GATEWAY_EVENT_UPDATE_AVAILABLE,
      payload: {
        updateAvailable: { currentVersion: "1.0.0", latestVersion: "9.9.9", channel: "latest" },
      },
    });
    expect(host.updateAvailable).toBeNull();

    secondClient.emitEvent({
      event: GATEWAY_EVENT_UPDATE_AVAILABLE,
      payload: {
        updateAvailable: { currentVersion: "1.0.0", latestVersion: "2.0.0", channel: "latest" },
      },
    });
    expect(host.updateAvailable).toEqual({
      currentVersion: "1.0.0",
      latestVersion: "2.0.0",
      channel: "latest",
    });
  });

  it("ignores stale client onClose callbacks after reconnect", () => {
    const host = createHost();

    connectGateway(host);
    const firstClient = gatewayClientInstances[0];
    expect(firstClient).toBeDefined();

    connectGateway(host);
    const secondClient = gatewayClientInstances[1];
    expect(secondClient).toBeDefined();

    firstClient.emitClose({ code: 1005 });
    expect(host.lastError).toBeNull();
    expect(host.lastErrorCode).toBeNull();

    secondClient.emitClose({ code: 1005 });
    expect(host.lastError).toBe("disconnected (1005): no reason");
    expect(host.lastErrorCode).toBeNull();
  });

  it("clears deferred session reload markers when replacing the gateway client", () => {
    const host = createHost();
    connectGateway(host);
    const deferredHost = host as TestGatewayHost & {
      pendingSessionMessageReloadSessionKey?: string | null;
      pendingSessionMessageReloadRunId?: string | null;
      pendingSessionMessageReloadNeedsReplay?: boolean;
    };
    deferredHost.pendingSessionMessageReloadSessionKey = "main";
    deferredHost.pendingSessionMessageReloadRunId = "run-before-reconnect";
    deferredHost.pendingSessionMessageReloadNeedsReplay = true;

    connectGateway(host);

    expect(deferredHost.pendingSessionMessageReloadSessionKey).toBeNull();
    expect(deferredHost.pendingSessionMessageReloadRunId).toBeNull();
    expect(deferredHost.pendingSessionMessageReloadNeedsReplay).toBe(false);
  });

  it("clears deferred session reload markers only when the active client closes", () => {
    const host = createHost();
    connectGateway(host);
    const firstClient = gatewayClientInstances[0];
    expect(firstClient).toBeDefined();
    connectGateway(host);
    const secondClient = gatewayClientInstances[1];
    expect(secondClient).toBeDefined();

    const deferredHost = host as TestGatewayHost & {
      pendingSessionMessageReloadSessionKey?: string | null;
      pendingSessionMessageReloadRunId?: string | null;
    };
    deferredHost.pendingSessionMessageReloadSessionKey = "main";
    deferredHost.pendingSessionMessageReloadRunId = "run-before-close";

    firstClient.emitClose({ code: 1005 });
    expect(deferredHost.pendingSessionMessageReloadSessionKey).toBe("main");
    expect(deferredHost.pendingSessionMessageReloadRunId).toBe("run-before-close");

    secondClient.emitClose({ code: 1005 });
    expect(deferredHost.pendingSessionMessageReloadSessionKey).toBeNull();
    expect(deferredHost.pendingSessionMessageReloadRunId).toBeNull();
  });

  it("invalidates chat history requests only for connection starts and active closes", () => {
    const host = createHost();

    connectGateway(host);
    const firstClient = gatewayClientInstances[0];
    expect(firstClient).toBeDefined();
    expect(invalidateChatHistoryRequestsMock).toHaveBeenCalledTimes(1);

    connectGateway(host);
    const secondClient = gatewayClientInstances[1];
    expect(secondClient).toBeDefined();
    expect(invalidateChatHistoryRequestsMock).toHaveBeenCalledTimes(2);

    firstClient.emitClose({ code: 1005 });
    expect(invalidateChatHistoryRequestsMock).toHaveBeenCalledTimes(2);

    secondClient.emitClose({ code: 1005 });
    expect(invalidateChatHistoryRequestsMock).toHaveBeenCalledTimes(3);
  });

  it("preserves pending approval requests across reconnect", () => {
    const host = createHost();
    host.execApprovalQueue = [
      {
        id: "approval-1",
        kind: "exec",
        title: "Approve command",
        summary: "rm -rf /tmp/nope",
        createdAtMs: Date.now(),
        expiresAtMs: Date.now() + 60_000,
      } as never,
    ];

    connectGateway(host);
    expect(host.execApprovalQueue).toHaveLength(1);

    connectGateway(host);
    expect(host.execApprovalQueue).toHaveLength(1);
    expect(host.execApprovalQueue[0]?.id).toBe("approval-1");
  });

  it("maps generic fetch-failed auth errors to actionable token mismatch message", () => {
    const host = createHost();

    connectGateway(host);
    const client = gatewayClientInstances[0];
    expect(client).toBeDefined();

    client.emitClose({
      code: 4008,
      reason: "connect failed",
      error: {
        code: "INVALID_REQUEST",
        message: "Fetch failed",
        details: { code: ConnectErrorDetailCodes.AUTH_TOKEN_MISMATCH },
      },
    });

    expect(host.lastErrorCode).toBe(ConnectErrorDetailCodes.AUTH_TOKEN_MISMATCH);
    expect(host.lastError).toContain("gateway token mismatch");
  });

  it("maps TypeError fetch failures to actionable auth rate-limit guidance", () => {
    const host = createHost();

    connectGateway(host);
    const client = gatewayClientInstances[0];
    expect(client).toBeDefined();

    client.emitClose({
      code: 4008,
      reason: "connect failed",
      error: {
        code: "INVALID_REQUEST",
        message: "TypeError: Failed to fetch",
        details: { code: ConnectErrorDetailCodes.AUTH_RATE_LIMITED },
      },
    });

    expect(host.lastErrorCode).toBe(ConnectErrorDetailCodes.AUTH_RATE_LIMITED);
    expect(host.lastError).toContain("too many failed authentication attempts");
  });

  it("maps generic fetch failures to actionable device identity guidance", () => {
    const host = createHost();

    connectGateway(host);
    const client = gatewayClientInstances[0];
    expect(client).toBeDefined();

    client.emitClose({
      code: 4008,
      reason: "connect failed",
      error: {
        code: "INVALID_REQUEST",
        message: "Fetch failed",
        details: { code: ConnectErrorDetailCodes.CONTROL_UI_DEVICE_IDENTITY_REQUIRED },
      },
    });

    expect(host.lastErrorCode).toBe(ConnectErrorDetailCodes.CONTROL_UI_DEVICE_IDENTITY_REQUIRED);
    expect(host.lastError).toContain("device identity required");
  });

  it("maps generic fetch failures to actionable origin guidance", () => {
    const host = createHost();

    connectGateway(host);
    const client = gatewayClientInstances[0];
    expect(client).toBeDefined();

    client.emitClose({
      code: 4008,
      reason: "connect failed",
      error: {
        code: "INVALID_REQUEST",
        message: "Fetch failed",
        details: { code: ConnectErrorDetailCodes.CONTROL_UI_ORIGIN_NOT_ALLOWED },
      },
    });

    expect(host.lastErrorCode).toBe(ConnectErrorDetailCodes.CONTROL_UI_ORIGIN_NOT_ALLOWED);
    expect(host.lastError).toContain("origin not allowed");
  });

  it("preserves specific close errors even when auth detail codes are present", () => {
    const host = createHost();

    connectGateway(host);
    const client = gatewayClientInstances[0];
    expect(client).toBeDefined();

    client.emitClose({
      code: 4008,
      reason: "connect failed",
      error: {
        code: "INVALID_REQUEST",
        message: "Failed to fetch gateway metadata from ws://127.0.0.1:18789",
        details: { code: ConnectErrorDetailCodes.AUTH_TOKEN_MISMATCH },
      },
    });

    expect(host.lastErrorCode).toBe(ConnectErrorDetailCodes.AUTH_TOKEN_MISMATCH);
    expect(host.lastError).toBe("Failed to fetch gateway metadata from ws://127.0.0.1:18789");
  });

  it("prefers structured connect errors over close reason", () => {
    const host = createHost();

    connectGateway(host);
    const client = gatewayClientInstances[0];
    expect(client).toBeDefined();

    client.emitClose({
      code: 4008,
      reason: "connect failed",
      error: {
        code: "INVALID_REQUEST",
        message:
          "unauthorized: gateway token mismatch (open the dashboard URL and paste the token in Control UI settings)",
        details: { code: "AUTH_TOKEN_MISMATCH" },
      },
    });

    expect(host.lastError).toContain("gateway token mismatch");
    expect(host.lastErrorCode).toBe("AUTH_TOKEN_MISMATCH");
  });

  it("surfaces scope-upgrade approval details instead of a dead pairing error", () => {
    const host = createHost();

    connectGateway(host);
    const client = gatewayClientInstances[0];
    expect(client).toBeDefined();

    client.emitClose({
      code: 4008,
      reason: "connect failed",
      error: {
        code: "NOT_PAIRED",
        message: "scope upgrade pending approval (requestId: req-123)",
        details: {
          code: ConnectErrorDetailCodes.PAIRING_REQUIRED,
          reason: "scope-upgrade",
          requestId: "req-123",
        },
      },
    });

    expect(host.lastErrorCode).toBe(ConnectErrorDetailCodes.PAIRING_REQUIRED);
    expect(host.lastError).toBe("scope upgrade pending approval (requestId: req-123)");
  });

  it("surfaces shutdown restart reasons before the socket closes", () => {
    const host = createHost();

    connectGateway(host);
    const client = gatewayClientInstances[0];
    expect(client).toBeDefined();

    client.emitEvent({
      event: "shutdown",
      payload: {
        reason: "config change requires gateway restart (plugins.installs)",
        restartExpectedMs: 1500,
      },
    });
    client.emitClose({ code: 1006 });

    expect(host.lastError).toBe(
      "Restarting: config change requires gateway restart (plugins.installs)",
    );
    expect(host.lastErrorCode).toBeNull();
  });

  it("clears pending shutdown messages on successful hello after reconnect", () => {
    const host = createHost();

    connectGateway(host);
    const client = gatewayClientInstances[0];
    expect(client).toBeDefined();

    client.emitEvent({
      event: "shutdown",
      payload: {
        reason: "config change",
        restartExpectedMs: 1500,
      },
    });
    client.emitClose({ code: 1006 });

    expect(host.lastError).toBe("Restarting: config change");

    client.emitHello();
    expect(host.lastError).toBeNull();

    client.emitClose({ code: 1006 });
    expect(host.lastError).toBe("disconnected (1006): no reason");
  });

  it("refreshes bootstrap config after hello", () => {
    const host = createHost();

    connectGateway(host);
    const client = gatewayClientInstances[0];
    expect(client).toBeDefined();

    client.emitHello();

    expect(loadControlUiBootstrapConfigMock).toHaveBeenCalledTimes(1);
    expect(loadControlUiBootstrapConfigMock).toHaveBeenCalledWith(host);
  });

  it("restores list-only and active-session subscriptions after reconnect", async () => {
    const host = createHost();

    connectGateway(host);
    const client = gatewayClientInstances[0];
    expect(client).toBeDefined();

    client.emitHello();
    await Promise.resolve();
    await Promise.resolve();

    expect(client.request.mock.calls.filter(([method]) => method === "sessions.subscribe")).toEqual(
      [["sessions.subscribe", {}]],
    );
    expect(
      client.request.mock.calls.filter(([method]) => method === "sessions.messages.subscribe"),
    ).toEqual([["sessions.messages.subscribe", { key: "main" }]]);

    client.emitClose({ code: 1006 });
    client.emitHello();
    await Promise.resolve();
    await Promise.resolve();

    expect(
      client.request.mock.calls.filter(([method]) => method === "sessions.subscribe"),
    ).toHaveLength(2);
    expect(
      client.request.mock.calls.filter(([method]) => method === "sessions.messages.subscribe"),
    ).toEqual([
      ["sessions.messages.subscribe", { key: "main" }],
      ["sessions.messages.subscribe", { key: "main" }],
    ]);
  });

  it("sends queued chat aborts after reconnect before clearing pending state", async () => {
    const host = createHost();
    host.chatRunId = "run-main";
    host.chatStream = "partial";
    host.pendingAbort = { runId: "run-main", sessionKey: "main" };

    connectGateway(host);
    const client = gatewayClientInstances[0];
    expect(client).toBeDefined();

    client.emitHello();
    await Promise.resolve();

    expect(client.request).toHaveBeenCalledWith("chat.abort", {
      sessionKey: "main",
      runId: "run-main",
    });
    expect(host.pendingAbort).toBeNull();
    expect(host.chatRunId).toBeNull();
    expect(host.chatStream).toBeNull();
  });

  it("logs and drops stale queued chat abort failures after reconnect", async () => {
    const host = createHost();
    host.pendingAbort = { runId: "run-stale", sessionKey: "main" };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    connectGateway(host);
    const client = gatewayClientInstances[0];
    expect(client).toBeDefined();
    const error = new Error("run already finished");
    client.request.mockImplementationOnce(async () => {
      throw error;
    });

    client.emitHello();
    await Promise.resolve();

    expect(host.pendingAbort).toBeNull();
    expect(warn).toHaveBeenCalledWith("[genesis] pending abort failed:", error);
    warn.mockRestore();
  });

  it("keeps shutdown restart reasons on service restart closes", () => {
    const host = createHost();

    connectGateway(host);
    const client = gatewayClientInstances[0];
    expect(client).toBeDefined();

    client.emitEvent({
      event: "shutdown",
      payload: {
        reason: "gateway restarting",
        restartExpectedMs: 1500,
      },
    });
    client.emitClose({ code: 1012, reason: "service restart" });

    expect(host.lastError).toBe("Restarting: gateway restarting");
    expect(host.lastErrorCode).toBeNull();
  });

  it("prefers shutdown restart reasons over non-1012 close reasons", () => {
    const host = createHost();

    connectGateway(host);
    const client = gatewayClientInstances[0];
    expect(client).toBeDefined();

    client.emitEvent({
      event: "shutdown",
      payload: {
        reason: "gateway restarting",
        restartExpectedMs: 1500,
      },
    });
    client.emitClose({ code: 1001, reason: "going away" });

    expect(host.lastError).toBe("Restarting: gateway restarting");
    expect(host.lastErrorCode).toBeNull();
  });

  it("does not reload chat history for each live tool result event", () => {
    const { client } = connectHostGateway();
    emitToolResultEvent(client);

    expect(loadChatHistoryMock).not.toHaveBeenCalled();
  });

  it("drops legacy assistant agent duplicates before logging but retains tool events", () => {
    const { host, client } = connectHostGateway();

    client.emitEvent({
      event: "agent",
      payload: {
        runId: "engine-run-1",
        seq: 1,
        stream: "assistant",
        ts: 1,
        sessionKey: "main",
        data: { text: "redundant", delta: "redundant" },
      },
    });

    expect(host.eventLogBuffer).toEqual([]);
    expect(host.eventLog).toEqual([]);

    emitToolResultEvent(client);

    expect(host.eventLogBuffer).toHaveLength(1);
    expect(host.eventLogBuffer[0]).toMatchObject({
      event: "agent",
      payload: { stream: "tool" },
    });
    expect(host.eventLog).toEqual(host.eventLogBuffer);
    expect(host.toolStreamOrder).toEqual(["tool-1"]);
  });

  it("stores BTW side results for the active session", () => {
    const { host, client } = connectHostGateway();

    client.emitEvent({
      event: "chat.side_result",
      payload: {
        kind: "btw",
        runId: "btw-run-1",
        sessionKey: "main",
        question: "what changed?",
        text: "Only the UI layer is missing support.",
        ts: 123,
      },
    });

    expect(host.chatSideResult).toMatchObject({
      kind: "btw",
      runId: "btw-run-1",
      question: "what changed?",
      text: "Only the UI layer is missing support.",
    });
    expect(host.chatSideResultTerminalRuns.has("btw-run-1")).toBe(true);
  });

  it("ignores tracked BTW terminal finals without tearing down the active run", () => {
    const { host, client } = connectHostGateway();
    host.chatRunId = "main-run-1";
    emitToolResultEvent(client);
    host.chatStream = "still streaming";
    expect(host.toolStreamOrder).toHaveLength(1);

    client.emitEvent({
      event: "chat.side_result",
      payload: {
        kind: "btw",
        runId: "btw-run-2",
        sessionKey: "main",
        question: "what changed?",
        text: "A dedicated side-result card now renders in webchat.",
        ts: 456,
      },
    });
    client.emitEvent({
      event: "chat",
      payload: {
        runId: "btw-run-2",
        sessionKey: "main",
        state: "final",
      },
    });

    expect(loadChatHistoryMock).not.toHaveBeenCalled();
    expect(host.chatRunId).toBe("main-run-1");
    expect(host.chatStream).toBe("still streaming");
    expect(host.toolStreamOrder).toHaveLength(1);
    expect(host.chatSideResultTerminalRuns.has("btw-run-2")).toBe(false);
  });

  it.each(["aborted", "error"] as const)(
    "cleans up tracked BTW %s events without touching the active run",
    (terminalState) => {
      const { host, client } = connectHostGateway();
      host.chatRunId = "main-run-2";
      emitToolResultEvent(client);
      host.chatStream = "stream in progress";

      client.emitEvent({
        event: "chat.side_result",
        payload: {
          kind: "btw",
          runId: `btw-run-${terminalState}`,
          sessionKey: "main",
          question: "what changed?",
          text: "Detached BTW response",
          ts: 789,
        },
      });
      client.emitEvent({
        event: "chat",
        payload: {
          runId: `btw-run-${terminalState}`,
          sessionKey: "main",
          state: terminalState,
          errorMessage: terminalState === "error" ? "btw failed" : undefined,
        },
      });

      expect(host.chatSideResultTerminalRuns.has(`btw-run-${terminalState}`)).toBe(false);
      expect(host.chatRunId).toBe("main-run-2");
      expect(host.chatStream).toBe("stream in progress");
      expect(host.toolStreamOrder).toHaveLength(1);
      expect(host.lastError).toBeNull();
    },
  );

  it.each(["aborted", "error"] as const)(
    "replays deferred session.message reloads after %s clears the active run",
    (terminalState) => {
      const { host, client } = connectHostGateway();
      host.chatRunId = "main-run-3";
      loadChatHistoryMock.mockClear();

      client.emitEvent({
        event: "session.message",
        payload: {
          sessionKey: "main",
        },
      });

      expect(loadChatHistoryMock).not.toHaveBeenCalled();

      client.emitEvent({
        event: "chat",
        payload: {
          runId: "main-run-3",
          sessionKey: "main",
          state: terminalState,
          errorMessage: terminalState === "error" ? "chat failed" : undefined,
        },
      });

      expect(host.chatRunId).toBeNull();
      expect(loadChatHistoryMock).toHaveBeenCalledTimes(1);
      expect(loadChatHistoryMock).toHaveBeenCalledWith(host);
    },
  );

  it("applies session.message payloads without a full history reload", () => {
    const { host, client } = connectHostGateway();
    loadChatHistoryMock.mockClear();

    client.emitEvent({
      event: "session.message",
      payload: {
        sessionKey: "main",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Saved note" }],
          __genesis: { id: "msg-1", seq: 1 },
        },
      },
    });

    expect(loadChatHistoryMock).not.toHaveBeenCalled();
    expect(host.chatMessages).toHaveLength(1);
    expect(host.chatMessages[0]).toMatchObject({
      role: "assistant",
      __genesis: { id: "msg-1", seq: 1 },
    });
  });

  it("reconciles active-run user transcript events and skips complete final reloads", () => {
    const { host, client } = connectHostGateway();
    host.chatRunId = "main-run-4";
    host.chatMessages = [
      {
        role: "user",
        content: [{ type: "text", text: "hello" }],
      },
    ];
    loadChatHistoryMock.mockClear();

    client.emitEvent({
      event: "session.message",
      payload: {
        sessionKey: "main",
        message: {
          role: "user",
          content: "hello",
          __genesis: { id: "msg-user-1", seq: 1 },
        },
      },
    });

    expect(loadChatHistoryMock).not.toHaveBeenCalled();
    expect(host.chatMessages).toHaveLength(1);
    expect(host.chatMessages[0]).toMatchObject({
      role: "user",
      __genesis: { id: "msg-user-1", seq: 1 },
    });

    client.emitEvent({
      event: "chat",
      payload: {
        runId: "main-run-4",
        sessionKey: "main",
        state: "final",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Done" }],
        },
      },
    });

    expect(host.chatRunId).toBeNull();
    expect(loadChatHistoryMock).not.toHaveBeenCalled();
    expect(host.chatMessages).toHaveLength(2);
    expect(host.chatMessages[1]).toMatchObject({
      role: "assistant",
      content: [{ type: "text", text: "Done" }],
    });
  });

  it("defers provisional active user transcript events until the canonical row arrives", () => {
    const { host, client } = connectHostGateway();
    const optimisticUser = {
      role: "user",
      content: [{ type: "text", text: "hello" }],
    };
    host.chatRunId = "main-run-5";
    host.chatMessages = [optimisticUser];

    client.emitEvent({
      event: "session.message",
      payload: {
        sessionKey: "main",
        message: {
          role: "user",
          content: "hello",
          __genesis: { seq: 1 },
        },
      },
    });

    expect(loadChatHistoryMock).not.toHaveBeenCalled();
    expect(host.chatMessages).toEqual([optimisticUser]);

    client.emitEvent({
      event: "chat",
      payload: {
        runId: "main-run-5",
        sessionKey: "main",
        state: "final",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Done" }],
        },
      },
    });

    expect(loadChatHistoryMock).toHaveBeenCalledTimes(1);

    const canonicalUser = {
      role: "user",
      content: "hello",
      __genesis: { id: "msg-user-5", seq: 2 },
    };
    client.emitEvent({
      event: "session.message",
      payload: {
        sessionKey: "main",
        messageId: "msg-user-5",
        message: canonicalUser,
      },
    });

    expect(loadChatHistoryMock).toHaveBeenCalledTimes(1);
    expect(
      host.chatMessages.filter((message) => (message as { role?: unknown }).role === "user"),
    ).toHaveLength(1);
    expect(host.chatMessages[0]).toEqual(canonicalUser);
  });

  it("hands a single idle provisional reload to a run that starts before history settles", async () => {
    const { host, client } = connectHostGateway();
    const pendingHistory = createDeferred<ChatHistoryLoadResult>();
    loadChatHistoryMock.mockImplementationOnce(() => pendingHistory.promise);

    client.emitEvent({
      event: "session.message",
      payload: {
        sessionKey: "main",
        message: {
          role: "user",
          content: "hello",
          __genesis: { seq: 1 },
        },
      },
    });

    expect(loadChatHistoryMock).toHaveBeenCalledTimes(1);
    host.chatRunId = "main-run-single-provisional";
    pendingHistory.resolve("run-stale");
    await Promise.resolve();
    await Promise.resolve();

    expect(
      (host as { pendingSessionMessageReloadSessionKey?: string | null })
        .pendingSessionMessageReloadSessionKey,
    ).toBe("main");
    expect(
      (host as { pendingSessionMessageReloadRunId?: string | null })
        .pendingSessionMessageReloadRunId,
    ).toBe("main-run-single-provisional");
    expect(loadChatHistoryMock).toHaveBeenCalledTimes(1);

    client.emitEvent({
      event: "chat",
      payload: {
        runId: "main-run-single-provisional",
        sessionKey: "main",
        state: "final",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Done" }],
        },
      },
    });

    expect(loadChatHistoryMock).toHaveBeenCalledTimes(2);
  });

  it("replays an idle provisional reload when a run starts and finishes before settlement", async () => {
    const firstHistory = createDeferred<ChatHistoryLoadResult>();
    loadChatHistoryMock.mockReturnValueOnce(firstHistory.promise).mockResolvedValueOnce("applied");
    const { host, client } = connectHostGateway();

    client.emitEvent({
      event: "session.message",
      payload: {
        sessionKey: "main",
        message: {
          role: "user",
          content: "hello",
          __genesis: { seq: 1 },
        },
      },
    });

    host.chatRunId = "main-run-finished-before-settlement";
    client.emitEvent({
      event: "chat",
      payload: {
        runId: "main-run-finished-before-settlement",
        sessionKey: "main",
        state: "final",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Done" }],
        },
      },
    });

    expect(host.chatRunId).toBeNull();
    firstHistory.resolve("run-stale");

    await vi.waitFor(() => {
      expect(loadChatHistoryMock).toHaveBeenCalledTimes(2);
      expect(
        (host as { pendingSessionMessageReloadSessionKey?: string | null })
          .pendingSessionMessageReloadSessionKey,
      ).toBeNull();
    });
  });

  it("does not consume a deferred reload marker from another run's terminal event", () => {
    const { host, client } = connectHostGateway();
    const optimisticUser = {
      role: "user",
      content: [{ type: "text", text: "hello" }],
    };
    host.chatRunId = "main-run-7";
    host.chatMessages = [optimisticUser];
    loadChatHistoryMock.mockClear();

    client.emitEvent({
      event: "session.message",
      payload: {
        sessionKey: "main",
        message: {
          role: "user",
          content: "hello",
          __genesis: { seq: 1 },
        },
      },
    });

    expect(
      (host as { pendingSessionMessageReloadSessionKey?: string | null })
        .pendingSessionMessageReloadSessionKey,
    ).toBe("main");
    expect(
      (host as { pendingSessionMessageReloadRunId?: string | null })
        .pendingSessionMessageReloadRunId,
    ).toBe("main-run-7");

    client.emitEvent({
      event: "chat",
      payload: {
        runId: "other-run",
        sessionKey: "main",
        state: "final",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Other run" }],
        },
      },
    });

    expect(loadChatHistoryMock).not.toHaveBeenCalled();
    expect(
      (host as { pendingSessionMessageReloadRunId?: string | null })
        .pendingSessionMessageReloadRunId,
    ).toBe("main-run-7");

    client.emitEvent({
      event: "chat",
      payload: {
        runId: "main-run-7",
        sessionKey: "main",
        state: "final",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Done" }],
        },
      },
    });

    expect(loadChatHistoryMock).toHaveBeenCalledTimes(1);
    expect(
      (host as { pendingSessionMessageReloadSessionKey?: string | null })
        .pendingSessionMessageReloadSessionKey,
    ).toBeNull();
    expect(
      (host as { pendingSessionMessageReloadRunId?: string | null })
        .pendingSessionMessageReloadRunId,
    ).toBeNull();
  });

  it("clears both deferred reload markers when the canonical user row arrives", () => {
    const { host, client } = connectHostGateway();
    const optimisticUser = {
      role: "user",
      content: [{ type: "text", text: "hello" }],
    };
    host.chatRunId = "main-run-8";
    host.chatMessages = [optimisticUser];

    client.emitEvent({
      event: "session.message",
      payload: {
        sessionKey: "main",
        message: {
          role: "user",
          content: "hello",
          __genesis: { seq: 1 },
        },
      },
    });
    client.emitEvent({
      event: "session.message",
      payload: {
        sessionKey: "main",
        messageId: "msg-user-8",
        message: {
          role: "user",
          content: "hello",
          __genesis: { id: "msg-user-8", seq: 2 },
        },
      },
    });

    expect(
      (host as { pendingSessionMessageReloadSessionKey?: string | null })
        .pendingSessionMessageReloadSessionKey,
    ).toBeNull();
    expect(
      (host as { pendingSessionMessageReloadRunId?: string | null })
        .pendingSessionMessageReloadRunId,
    ).toBeNull();
  });

  it("reloads once instead of appending a provisional user event after final", () => {
    const { host, client } = connectHostGateway();
    const optimisticUser = {
      role: "user",
      content: [{ type: "text", text: "hello" }],
    };
    host.chatMessages = [optimisticUser];

    client.emitEvent({
      event: "chat",
      payload: {
        runId: "main-run-6",
        sessionKey: "main",
        state: "final",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Done" }],
        },
      },
    });

    client.emitEvent({
      event: "session.message",
      payload: {
        sessionKey: "main",
        message: {
          role: "user",
          content: "hello",
          __genesis: { seq: 1 },
        },
      },
    });
    client.emitEvent({
      event: "session.message",
      payload: {
        sessionKey: "main",
        message: {
          role: "user",
          content: "hello",
          __genesis: { seq: 1 },
        },
      },
    });

    expect(loadChatHistoryMock).toHaveBeenCalledTimes(1);
    expect(
      host.chatMessages.filter((message) => (message as { role?: unknown }).role === "user"),
    ).toHaveLength(1);

    const canonicalUser = {
      role: "user",
      content: "hello",
      __genesis: { id: "msg-user-6", seq: 2 },
    };
    client.emitEvent({
      event: "session.message",
      payload: {
        sessionKey: "main",
        messageId: "msg-user-6",
        message: canonicalUser,
      },
    });

    expect(loadChatHistoryMock).toHaveBeenCalledTimes(1);
    expect(
      host.chatMessages.filter((message) => (message as { role?: unknown }).role === "user"),
    ).toHaveLength(1);
    expect(host.chatMessages[0]).toEqual(canonicalUser);
  });

  it("allows a second idle provisional event after its first history reload settles", async () => {
    const pendingHistory = createDeferred<ChatHistoryLoadResult>();
    loadChatHistoryMock.mockReturnValueOnce(pendingHistory.promise);
    const { host, client } = connectHostGateway();

    client.emitEvent({
      event: "session.message",
      payload: {
        sessionKey: "main",
        message: {
          role: "user",
          content: "first",
          __genesis: { seq: 1 },
        },
      },
    });

    expect(loadChatHistoryMock).toHaveBeenCalledTimes(1);
    expect(
      (host as { pendingSessionMessageReloadSessionKey?: string | null })
        .pendingSessionMessageReloadSessionKey,
    ).toBe("main");
    expect(
      (host as { pendingSessionMessageReloadRunId?: string | null })
        .pendingSessionMessageReloadRunId,
    ).toBeNull();

    pendingHistory.resolve("applied");
    await pendingHistory.promise;
    await vi.waitFor(() => {
      expect(
        (host as { pendingSessionMessageReloadSessionKey?: string | null })
          .pendingSessionMessageReloadSessionKey,
      ).toBeNull();
    });

    client.emitEvent({
      event: "session.message",
      payload: {
        sessionKey: "main",
        message: {
          role: "user",
          content: "second",
          __genesis: { seq: 2 },
        },
      },
    });

    expect(loadChatHistoryMock).toHaveBeenCalledTimes(2);
  });

  it.each(["stale", "failed"] as const)(
    "replays a second idle provisional event when the first history reload settles as %s",
    async (firstResult) => {
      const firstHistory = createDeferred<ChatHistoryLoadResult>();
      const secondHistory = createDeferred<ChatHistoryLoadResult>();
      loadChatHistoryMock
        .mockReturnValueOnce(firstHistory.promise)
        .mockReturnValueOnce(secondHistory.promise);
      const { host, client } = connectHostGateway();
      const deferredHost = host as TestGatewayHost & {
        pendingSessionMessageReloadSessionKey?: string | null;
        pendingSessionMessageReloadRunId?: string | null;
        pendingSessionMessageReloadNeedsReplay?: boolean;
      };

      for (const seq of [1, 2]) {
        client.emitEvent({
          event: "session.message",
          payload: {
            sessionKey: "main",
            message: {
              role: "user",
              content: `message-${seq}`,
              __genesis: { seq },
            },
          },
        });
      }

      expect(loadChatHistoryMock).toHaveBeenCalledTimes(1);
      expect(deferredHost.pendingSessionMessageReloadSessionKey).toBe("main");
      expect(deferredHost.pendingSessionMessageReloadNeedsReplay).toBe(true);

      firstHistory.resolve(firstResult);
      await firstHistory.promise;
      await vi.waitFor(() => {
        expect(loadChatHistoryMock).toHaveBeenCalledTimes(2);
      });
      expect(deferredHost.pendingSessionMessageReloadSessionKey).toBe("main");
      expect(deferredHost.pendingSessionMessageReloadNeedsReplay).toBe(false);

      secondHistory.resolve("applied");
      await secondHistory.promise;
      await vi.waitFor(() => {
        expect(deferredHost.pendingSessionMessageReloadSessionKey).toBeNull();
      });
      expect(deferredHost.pendingSessionMessageReloadNeedsReplay).toBe(false);
    },
  );

  it("hands off an idle provisional replay marker when a run starts before settlement", async () => {
    const firstHistory = createDeferred<ChatHistoryLoadResult>();
    loadChatHistoryMock.mockReturnValueOnce(firstHistory.promise);
    const { host, client } = connectHostGateway();
    const deferredHost = host as TestGatewayHost & {
      pendingSessionMessageReloadSessionKey?: string | null;
      pendingSessionMessageReloadRunId?: string | null;
      pendingSessionMessageReloadNeedsReplay?: boolean;
    };

    for (const seq of [1, 2]) {
      client.emitEvent({
        event: "session.message",
        payload: {
          sessionKey: "main",
          message: {
            role: "user",
            content: `message-${seq}`,
            __genesis: { seq },
          },
        },
      });
    }
    host.chatRunId = "active-run";
    host.chatStream = "still streaming";
    host.toolStreamOrder = ["tool-1"];

    firstHistory.resolve("applied");
    await vi.waitFor(() => {
      expect(loadChatHistoryMock).toHaveBeenCalledTimes(1);
      expect(deferredHost.pendingSessionMessageReloadRunId).toBe("active-run");
      expect(deferredHost.pendingSessionMessageReloadNeedsReplay).toBe(false);
    });

    expect(host.chatStream).toBe("still streaming");
    expect(host.toolStreamOrder).toEqual(["tool-1"]);
  });

  it("clears tracked BTW terminal runs after reconnect hello", () => {
    const host = createHost();

    connectGateway(host);
    const firstClient = gatewayClientInstances[0];
    expect(firstClient).toBeDefined();

    firstClient.emitEvent({
      event: "chat.side_result",
      payload: {
        kind: "btw",
        runId: "btw-run-reconnect",
        sessionKey: "main",
        question: "what changed?",
        text: "Temporary BTW state",
        ts: 987,
      },
    });
    expect(host.chatSideResultTerminalRuns.has("btw-run-reconnect")).toBe(true);

    connectGateway(host);
    const reconnectClient = gatewayClientInstances[1];
    expect(reconnectClient).toBeDefined();

    reconnectClient.emitHello();

    expect(host.chatSideResultTerminalRuns.size).toBe(0);
  });

  it("ignores BTW side results for other sessions", () => {
    const { host, client } = connectHostGateway();

    client.emitEvent({
      event: "chat.side_result",
      payload: {
        kind: "btw",
        runId: "btw-run-3",
        sessionKey: "other-session",
        question: "what changed?",
        text: "Nothing here.",
        ts: 789,
      },
    });

    expect(host.chatSideResult).toBeNull();
    expect(host.chatSideResultTerminalRuns.size).toBe(0);
  });

  it("routes plugin.approval.requested into execApprovalQueue with kind plugin", () => {
    const host = createHost();

    connectGateway(host);
    const client = gatewayClientInstances[0];
    expect(client).toBeDefined();

    client.emitEvent({
      event: "plugin.approval.requested",
      payload: {
        id: "plugin-approval-1",
        createdAtMs: Date.now(),
        expiresAtMs: Date.now() + 120_000,
        request: {
          title: "Dangerous command detected",
          description: "chmod 777 script.sh",
          severity: "high",
          pluginId: "sage",
          agentId: "agent-1",
          sessionKey: "main",
        },
      },
    });

    expect(host.execApprovalQueue).toHaveLength(1);
    expect(host.execApprovalQueue[0]?.id).toBe("plugin-approval-1");
    expect((host.execApprovalQueue[0] as { kind: string }).kind).toBe("plugin");
  });

  it("routes plugin.approval.resolved to remove from execApprovalQueue", () => {
    const host = createHost();

    connectGateway(host);
    const client = gatewayClientInstances[0];
    expect(client).toBeDefined();

    // Add a plugin approval first
    client.emitEvent({
      event: "plugin.approval.requested",
      payload: {
        id: "plugin-approval-2",
        createdAtMs: Date.now(),
        expiresAtMs: Date.now() + 120_000,
        request: { title: "Alert" },
      },
    });
    expect(host.execApprovalQueue).toHaveLength(1);

    // Resolve it
    client.emitEvent({
      event: "plugin.approval.resolved",
      payload: { id: "plugin-approval-2", decision: "allow-once" },
    });
    expect(host.execApprovalQueue).toHaveLength(0);
  });

  it.each([
    ["malformed", { sessionKey: "main", state: "final" }],
    ["foreign", { runId: "other-run", sessionKey: "main", state: "final" }],
  ] as const)("does not run terminal cleanup for %s events", (_kind, payload) => {
    const { host, client } = connectHostGateway();
    host.chatRunId = "active-run";
    emitToolResultEvent(client);
    host.chatStream = "still streaming";

    client.emitEvent({ event: "chat", payload });

    expect(host.chatRunId).toBe("active-run");
    expect(host.chatStream).toBe("still streaming");
    expect(host.toolStreamOrder).toEqual(["tool-1"]);
    expect(loadChatHistoryMock).not.toHaveBeenCalled();
  });

  it("does not run terminal cleanup when no chat run is active", () => {
    const { host, client } = connectHostGateway();
    emitToolResultEvent(client);

    client.emitEvent({
      event: "chat",
      payload: {
        runId: "engine-run-1",
        sessionKey: "main",
        state: "final",
      },
    });

    expect(host.chatRunId).toBeNull();
    expect(host.toolStreamOrder).toEqual(["tool-1"]);
    expect(loadChatHistoryMock).not.toHaveBeenCalled();
  });

  it("reloads chat history once after the final chat event when tool output was used", () => {
    const { host, client } = connectHostGateway();
    host.chatRunId = "engine-run-1";
    emitToolResultEvent(client);

    client.emitEvent({
      event: "chat",
      payload: {
        runId: "engine-run-1",
        sessionKey: "main",
        state: "final",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Done" }],
        },
      },
    });

    expect(loadChatHistoryMock).toHaveBeenCalledTimes(1);
  });

  it("cleans tool state and flushes queued messages when tool history reload fails", async () => {
    loadChatHistoryMock.mockResolvedValueOnce("failed");
    const { host, client } = connectHostGateway();
    host.chatRunId = "engine-run-1";
    host.connected = true;
    (host as unknown as { updateComplete: Promise<unknown> }).updateComplete = new Promise(
      () => {},
    );
    host.chatQueue = [{ id: "queued", text: "next", createdAt: 1 }];
    emitToolResultEvent(client);

    client.emitEvent({
      event: "chat",
      payload: {
        runId: "engine-run-1",
        sessionKey: "main",
        state: "final",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Done" }],
        },
      },
    });

    await vi.waitFor(() => {
      expect(host.toolStreamOrder).toEqual([]);
      expect(host.chatSending).toBe(false);
    });
    expect(host.connected).toBe(true);
    expect(host.chatQueue).toEqual([]);
  });

  it("cleans tool state and flushes queued messages when generic history staleness supersedes tool history", async () => {
    const pendingHistory = createDeferred<ChatHistoryLoadResult>();
    loadChatHistoryMock.mockReturnValueOnce(pendingHistory.promise);
    const { host, client } = connectHostGateway();
    host.chatRunId = "engine-run-1";
    host.connected = true;
    (host as unknown as { updateComplete: Promise<unknown> }).updateComplete = new Promise(
      () => {},
    );
    host.chatQueue = [{ id: "queued", text: "next", createdAt: 1 }];
    emitToolResultEvent(client);

    client.emitEvent({
      event: "chat",
      payload: {
        runId: "engine-run-1",
        sessionKey: "main",
        state: "final",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Done" }],
        },
      },
    });

    pendingHistory.resolve("stale");
    await pendingHistory.promise;

    await vi.waitFor(() => {
      expect(host.toolStreamOrder).toEqual([]);
      expect(host.chatSending).toBe(false);
    });
    expect(host.connected).toBe(true);
    expect(host.chatQueue).toEqual([]);
  });

  it("does not reset tool state when a replacement run makes tool history stale", async () => {
    const pendingHistory = createDeferred<ChatHistoryLoadResult>();
    loadChatHistoryMock.mockReturnValueOnce(pendingHistory.promise);
    const { host, client } = connectHostGateway();
    host.chatRunId = "engine-run-1";
    emitToolResultEvent(client);

    client.emitEvent({
      event: "chat",
      payload: {
        runId: "engine-run-1",
        sessionKey: "main",
        state: "final",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Done" }],
        },
      },
    });

    host.chatRunId = "replacement-run";
    pendingHistory.resolve("stale");
    await pendingHistory.promise;
    await Promise.resolve();

    expect(host.toolStreamOrder).toEqual(["tool-1"]);
  });
});

describe("resolveControlUiClientVersion", () => {
  it("returns serverVersion for same-origin websocket targets", () => {
    expect(
      resolveControlUiClientVersion({
        gatewayUrl: "ws://localhost:8787",
        serverVersion: "2026.3.7",
        pageUrl: "http://localhost:8787/genesis/",
      }),
    ).toBe("2026.3.7");
  });

  it("returns serverVersion for same-origin relative targets", () => {
    expect(
      resolveControlUiClientVersion({
        gatewayUrl: "/ws",
        serverVersion: "2026.3.7",
        pageUrl: "https://control.example.com/genesis/",
      }),
    ).toBe("2026.3.7");
  });

  it("returns serverVersion for same-origin http targets", () => {
    expect(
      resolveControlUiClientVersion({
        gatewayUrl: "https://control.example.com/ws",
        serverVersion: "2026.3.7",
        pageUrl: "https://control.example.com/genesis/",
      }),
    ).toBe("2026.3.7");
  });

  it("omits serverVersion for cross-origin targets", () => {
    expect(
      resolveControlUiClientVersion({
        gatewayUrl: "wss://gateway.example.com",
        serverVersion: "2026.3.7",
        pageUrl: "https://control.example.com/genesis/",
      }),
    ).toBeUndefined();
  });
});
