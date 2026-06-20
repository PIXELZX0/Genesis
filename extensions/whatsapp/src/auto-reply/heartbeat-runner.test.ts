import { redactIdentifier } from "genesis/plugin-sdk/logging-core";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { sendMessageWhatsApp } from "../send.js";
import type { getReplyFromConfig } from "./heartbeat-runner.runtime.js";

const HEARTBEAT_TOKEN = "HEARTBEAT_OK";

const state = vi.hoisted(() => ({
  visibility: { showAlerts: true, showOk: true, useIndicator: false },
  store: {} as Record<string, { updatedAt?: number; sessionId?: string }>,
  snapshot: {
    key: "k",
    entry: { sessionId: "s1", updatedAt: 123 },
    fresh: false,
    resetPolicy: { mode: "none", atHour: null, idleMinutes: null },
    dailyResetAt: null as number | null,
    idleExpiresAt: null as number | null,
  },
  events: [] as unknown[],
  loggerInfoCalls: [] as unknown[][],
  loggerWarnCalls: [] as unknown[][],
  heartbeatInfoLogs: [] as string[],
  heartbeatWarnLogs: [] as string[],
}));

vi.mock("./heartbeat-runner.runtime.js", () => {
  const logger = {
    child: () => logger,
    info: (...args: unknown[]) => state.loggerInfoCalls.push(args),
    warn: (...args: unknown[]) => state.loggerWarnCalls.push(args),
    error: vi.fn(),
    debug: vi.fn(),
  };
  return {
    DEFAULT_HEARTBEAT_ACK_MAX_CHARS: 32,
    HEARTBEAT_TOKEN,
    appendCronStyleCurrentTimeLine: (body: string) =>
      `${body}\nCurrent time: 2026-02-15T00:00:00Z (mock)`,
    canonicalizeMainSessionAlias: ({ sessionKey }: { sessionKey: string }) => sessionKey,
    emitHeartbeatEvent: (event: unknown) => state.events.push(event),
    formatError: (err: unknown) => `ERR:${String(err)}`,
    getChildLogger: () => logger,
    getReplyFromConfig: vi.fn(async () => undefined),
    hasOutboundReplyContent: (payload: { text?: string } | undefined) =>
      Boolean(payload?.text?.trim()),
    loadConfig: () => ({ agents: { defaults: {} }, session: {} }),
    loadSessionStore: () => state.store,
    normalizeMainKey: () => null,
    redactIdentifier,
    resolveHeartbeatPrompt: (prompt?: string) => prompt || "Heartbeat",
    resolveHeartbeatReplyPayload: (reply: unknown) => reply,
    resolveHeartbeatVisibility: () => state.visibility,
    resolveIndicatorType: (status: string) => `indicator:${status}`,
    resolveSendableOutboundReplyParts: (payload: { text?: string }) => ({
      text: payload.text ?? "",
      hasMedia: false,
    }),
    resolveSessionKey: () => "k",
    resolveStorePath: () => "/tmp/store.json",
    resolveWhatsAppHeartbeatRecipients: () => [],
    sendMessageWhatsApp: vi.fn(async () => ({ messageId: "m1" })),
    stripHeartbeatToken: (text: string) => {
      const trimmed = text.trim();
      if (trimmed === HEARTBEAT_TOKEN) {
        return { shouldSkip: true, text: "" };
      }
      return { shouldSkip: false, text: trimmed };
    },
    updateSessionStore: async (_path: string, updater: (store: typeof state.store) => void) => {
      updater(state.store);
    },
    whatsappHeartbeatLog: {
      info: (msg: string) => state.heartbeatInfoLogs.push(msg),
      warn: (msg: string) => state.heartbeatWarnLogs.push(msg),
    },
  };
});

vi.mock("./session-snapshot.js", () => ({
  getSessionSnapshot: () => state.snapshot,
}));

vi.mock("../reconnect.js", () => ({
  newConnectionId: () => "run-1",
}));

describe("runWebHeartbeatOnce", () => {
  let senderMock: ReturnType<typeof vi.fn>;
  let sender: typeof sendMessageWhatsApp;
  let replyResolverMock: ReturnType<typeof vi.fn>;
  let replyResolver: typeof getReplyFromConfig;
  let runWebHeartbeatOnce: typeof import("./heartbeat-runner.js").runWebHeartbeatOnce;

  const buildRunArgs = (overrides: Record<string, unknown> = {}) => ({
    cfg: { agents: { defaults: {} }, session: {} } as never,
    to: "+123",
    sender,
    replyResolver,
    ...overrides,
  });

  beforeAll(async () => {
    ({ runWebHeartbeatOnce } = await import("./heartbeat-runner.js"));
  });

  beforeEach(() => {
    state.visibility = { showAlerts: true, showOk: true, useIndicator: false };
    state.store = { k: { updatedAt: 999, sessionId: "s1" } };
    state.snapshot = {
      key: "k",
      entry: { sessionId: "s1", updatedAt: 123 },
      fresh: false,
      resetPolicy: { mode: "none", atHour: null, idleMinutes: null },
      dailyResetAt: null,
      idleExpiresAt: null,
    };
    state.events = [];
    state.loggerInfoCalls = [];
    state.loggerWarnCalls = [];
    state.heartbeatInfoLogs = [];
    state.heartbeatWarnLogs = [];

    senderMock = vi.fn(async () => ({ messageId: "m1" }));
    sender = senderMock as unknown as typeof sendMessageWhatsApp;
    replyResolverMock = vi.fn(async () => undefined);
    replyResolver = replyResolverMock as unknown as typeof getReplyFromConfig;
  });

  it("supports manual override body dry-run without sending", async () => {
    await runWebHeartbeatOnce(buildRunArgs({ overrideBody: "hello", dryRun: true }));
    expect(senderMock).not.toHaveBeenCalled();
    expect(state.events).toHaveLength(0);
  });
});
