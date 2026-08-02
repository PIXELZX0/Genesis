import { describe, expect, it, vi } from "vitest";
import { createPiIsolationHookProxyBridge } from "./hook-proxy.js";

describe("PI isolation child hook proxy", () => {
  it("requests before_prompt_build results and forwards agent_end notifications", async () => {
    const frames: Array<Record<string, unknown>> = [];
    const send = vi.fn(async (frame: Record<string, unknown>) => {
      frames.push(frame);
    });
    const bridge = createPiIsolationHookProxyBridge({
      activeHookNames: ["before_prompt_build", "agent_end"],
      send,
    });
    const event = { prompt: "hello", messages: [{ role: "user", content: "history" }] };
    const context = { runId: "run-1", sessionId: "session-1" };

    const request = bridge.hookRunner.runBeforePromptBuild(event, context);
    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
    const requestId = frames[0]?.requestId as string;
    expect(frames[0]).toMatchObject({
      type: "hook_request",
      requestId,
      hookName: "before_prompt_build",
      event,
      context,
    });
    expect(
      bridge.resolve(requestId, {
        prependContext: "parent context",
        appendSystemContext: "parent system suffix",
      }),
    ).toBe(true);
    await expect(request).resolves.toEqual({
      prependContext: "parent context",
      appendSystemContext: "parent system suffix",
    });

    await bridge.hookRunner.runAgentEnd(
      { messages: event.messages, newMessages: event.messages, success: true },
      context,
    );
    expect(frames[1]).toMatchObject({
      type: "hook_notification",
      hookName: "agent_end",
      event: { messages: event.messages, newMessages: event.messages, success: true },
      context,
    });
  });

  it("exposes only advertised hooks and rejects pending requests on shutdown", async () => {
    const send = vi.fn(async () => undefined);
    const bridge = createPiIsolationHookProxyBridge({
      activeHookNames: ["before_prompt_build"],
      send,
    });

    expect(bridge.hookRunner.hasHooks("before_prompt_build")).toBe(true);
    expect(bridge.hookRunner.hasHooks("agent_end")).toBe(false);
    expect(bridge.hookRunner.hasHooks("llm_input")).toBe(false);
    await bridge.hookRunner.runAgentEnd({ messages: [], success: true }, {});
    expect(send).not.toHaveBeenCalled();

    const request = bridge.hookRunner.runBeforePromptBuild({ prompt: "hello", messages: [] }, {});
    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
    const shutdownError = new Error("child shutdown");
    bridge.rejectAll(shutdownError);
    await expect(request).rejects.toBe(shutdownError);
  });
});
