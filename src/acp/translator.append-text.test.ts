import type { PromptRequest } from "@agentclientprotocol/sdk";
import { describe, expect, it, vi } from "vitest";
import type { GatewayClient } from "../gateway/client.js";
import { createInMemorySessionStore } from "./session.js";
import { AcpGatewayAgent } from "./translator.js";
import {
  createChatEvent,
  DEFAULT_SESSION_ID,
  DEFAULT_SESSION_KEY,
} from "./translator.prompt-harness.test-support.js";
import { createAcpConnection, createAcpGateway } from "./translator.test-helpers.js";

async function createAppendTextHarness() {
  let runId: string | undefined;
  const request = vi.fn(async (method: string, params?: Record<string, unknown>) => {
    if (method === "chat.send") {
      runId = params?.idempotencyKey as string | undefined;
      return new Promise<never>(() => {});
    }
    return {};
  }) as GatewayClient["request"];

  const connection = createAcpConnection();
  const sessionStore = createInMemorySessionStore();
  sessionStore.createSession({
    sessionId: DEFAULT_SESSION_ID,
    sessionKey: DEFAULT_SESSION_KEY,
    cwd: "/tmp",
  });
  const agent = new AcpGatewayAgent(connection, createAcpGateway(request), { sessionStore });
  const promptPromise = agent.prompt({
    sessionId: DEFAULT_SESSION_ID,
    prompt: [{ type: "text", text: "hello" }],
    _meta: {},
  } as unknown as PromptRequest);

  await vi.waitFor(() => {
    expect(runId).toBeDefined();
  });

  return { agent, connection, promptPromise, runId: runId! };
}

function messageChunkTexts(mock: ReturnType<typeof vi.fn>): string[] {
  return mock.mock.calls
    .map(
      ([arg]) =>
        (arg as { update?: { sessionUpdate?: string; content?: { text?: string } } })?.update,
    )
    .filter((update) => update?.sessionUpdate === "agent_message_chunk")
    .map((update) => update?.content?.text ?? "");
}

describe("acp translator incremental appendText deltas", () => {
  it("emits an agent_message_chunk per incremental appendText delta", async () => {
    const { agent, connection, runId } = await createAppendTextHarness();

    await agent.handleGatewayEvent(
      createChatEvent({
        runId,
        sessionKey: DEFAULT_SESSION_KEY,
        seq: 1,
        state: "delta",
        appendText: "Hello",
      }),
    );
    await agent.handleGatewayEvent(
      createChatEvent({
        runId,
        sessionKey: DEFAULT_SESSION_KEY,
        seq: 2,
        state: "delta",
        appendText: " world",
      }),
    );

    expect(messageChunkTexts(connection.__sessionUpdateMock)).toEqual(["Hello", " world"]);
  });

  it("does not re-emit already-streamed text on the final snapshot", async () => {
    const { agent, connection, promptPromise, runId } = await createAppendTextHarness();

    await agent.handleGatewayEvent(
      createChatEvent({
        runId,
        sessionKey: DEFAULT_SESSION_KEY,
        seq: 1,
        state: "delta",
        appendText: "Hello world",
      }),
    );
    await agent.handleGatewayEvent(
      createChatEvent({
        runId,
        sessionKey: DEFAULT_SESSION_KEY,
        seq: 2,
        state: "final",
        message: { role: "assistant", content: [{ type: "text", text: "Hello world" }] },
      }),
    );

    expect(messageChunkTexts(connection.__sessionUpdateMock)).toEqual(["Hello world"]);
    await expect(promptPromise).resolves.toEqual({ stopReason: "end_turn" });
  });

  it("re-baselines sent text on a reset incremental delta", async () => {
    const { agent, connection, runId } = await createAppendTextHarness();

    await agent.handleGatewayEvent(
      createChatEvent({
        runId,
        sessionKey: DEFAULT_SESSION_KEY,
        seq: 1,
        state: "delta",
        appendText: "Hello",
      }),
    );
    // Prefix mutated upstream: producer sends the full current text with reset.
    await agent.handleGatewayEvent(
      createChatEvent({
        runId,
        sessionKey: DEFAULT_SESSION_KEY,
        seq: 2,
        state: "delta",
        appendText: "Fresh",
        reset: true,
      }),
    );
    // Final snapshot matches the re-baselined text, so no duplicate chunk.
    await agent.handleGatewayEvent(
      createChatEvent({
        runId,
        sessionKey: DEFAULT_SESSION_KEY,
        seq: 3,
        state: "final",
        message: { role: "assistant", content: [{ type: "text", text: "Fresh" }] },
      }),
    );

    expect(messageChunkTexts(connection.__sessionUpdateMock)).toEqual(["Hello", "Fresh"]);
  });
});
