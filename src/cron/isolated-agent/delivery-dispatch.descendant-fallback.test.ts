import { beforeEach, describe, expect, it, vi } from "vitest";

const deliverOutboundPayloadsMock = vi.hoisted(() => vi.fn());

vi.mock("./delivery-outbound.runtime.js", () => ({
  buildOutboundSessionContext: vi.fn(),
  createOutboundSendDeps: vi.fn(() => ({})),
  deliverOutboundPayloads: deliverOutboundPayloadsMock,
  enqueueSystemEvent: vi.fn(),
  resolveAgentOutboundIdentity: vi.fn(),
}));

vi.mock("../../agents/subagent-registry-read.js", () => ({
  countActiveDescendantRuns: vi.fn().mockReturnValue(0),
  listDescendantRunsForRequester: vi.fn().mockReturnValue([]),
}));

vi.mock("../../agents/run-wait.js", async () => {
  const actual = await vi.importActual<typeof import("../../agents/run-wait.js")>(
    "../../agents/run-wait.js",
  );
  return {
    ...actual,
    readLatestAssistantReply: vi.fn().mockResolvedValue(undefined),
  };
});

const { listDescendantRunsForRequester } = await import("../../agents/subagent-registry-read.js");
const { readLatestAssistantReply } = await import("../../agents/run-wait.js");
const { dispatchCronDelivery, resetCompletedDirectCronDeliveriesForTests } =
  await import("./delivery-dispatch.js");
const { makeIsolatedAgentJobFixture } = await import("./job-fixtures.js");

const CRON_SESSION_KEY = "agent:main:cron:test-job";

function mockCompletedDescendantReplies(replies: Record<string, string>) {
  vi.mocked(listDescendantRunsForRequester).mockReturnValue(
    Object.keys(replies).map((childSessionKey, index) => ({
      runId: `run-${childSessionKey}`,
      childSessionKey,
      requesterSessionKey: CRON_SESSION_KEY,
      requesterDisplayKey: CRON_SESSION_KEY,
      task: childSessionKey,
      cleanup: "keep" as const,
      createdAt: 1_000,
      endedAt: 2_000 + index,
    })),
  );
  vi.mocked(readLatestAssistantReply).mockImplementation(
    async ({ sessionKey }) => replies[sessionKey],
  );
}

async function dispatchInterimCronReply() {
  return await dispatchCronDelivery({
    cfg: {},
    cfgWithAgentDefaults: {},
    deps: {} as never,
    job: makeIsolatedAgentJobFixture(),
    agentId: "main",
    agentSessionKey: CRON_SESSION_KEY,
    sessionId: "cron-session-id",
    runStartedAt: 1_000,
    runEndedAt: 3_000,
    timeoutMs: 1_000,
    resolvedDelivery: { ok: true, channel: "telegram", to: "123", mode: "explicit" },
    deliveryRequested: true,
    skipHeartbeatDelivery: false,
    deliveryBestEffort: false,
    deliveryPayloadHasStructuredContent: false,
    deliveryPayloads: [{ text: "on it" }],
    synthesizedText: "on it",
    isAborted: () => false,
    abortReason: () => "aborted",
    withRunSession: (result) => ({
      ...result,
      sessionId: "cron-session-id",
      sessionKey: CRON_SESSION_KEY,
    }),
  });
}

describe("dispatchCronDelivery descendant fallback", () => {
  beforeEach(() => {
    resetCompletedDirectCronDeliveriesForTests();
    deliverOutboundPayloadsMock.mockReset();
    deliverOutboundPayloadsMock.mockResolvedValue([{ channel: "telegram", messageId: "m1" }]);
  });

  it("delivers sibling output when one descendant declares NO_REPLY", async () => {
    mockCompletedDescendantReplies({
      "child-a": "NO_REPLY — no new alerts in repo A",
      "child-b": "Repo B: 2 failing builds",
    });

    const state = await dispatchInterimCronReply();

    expect(state.delivered).toBe(true);
    expect(deliverOutboundPayloadsMock).toHaveBeenCalledTimes(1);
    expect(deliverOutboundPayloadsMock.mock.calls[0]?.[0]?.payloads).toEqual([
      { text: "Repo B: 2 failing builds" },
    ]);
  });

  it("delivers sibling output when the last descendant ends with NO_REPLY", async () => {
    mockCompletedDescendantReplies({
      "child-a": "Repo A: deploy finished",
      "child-b": "Nothing new in repo B. NO_REPLY",
    });

    const state = await dispatchInterimCronReply();

    expect(state.delivered).toBe(true);
    expect(deliverOutboundPayloadsMock.mock.calls[0]?.[0]?.payloads).toEqual([
      { text: "Repo A: deploy finished" },
    ]);
  });

  it("stays silent instead of sending the interim text when every descendant is silent", async () => {
    mockCompletedDescendantReplies({
      "child-a": "NO_REPLY",
      "child-b": "NO_REPLY — nothing new in repo B",
    });

    const state = await dispatchInterimCronReply();

    expect(state.delivered).toBe(false);
    expect(state.deliveryAttempted).toBe(true);
    expect(deliverOutboundPayloadsMock).not.toHaveBeenCalled();
  });
});
