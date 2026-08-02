import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { describe, expect, it, vi } from "vitest";
import { createPiIsolationToolProxyBridge } from "./tool-proxy.js";

function createDescriptor() {
  return {
    name: "fixture",
    label: "Fixture",
    description: "Fixture tool",
    parameters: { type: "object", properties: { value: { type: "number" } } },
  };
}

type SentFrame = {
  type: string;
  bridgeCallId: string;
  toolCallId?: string;
  toolName?: string;
  params?: unknown;
};

function createSender() {
  const frames: SentFrame[] = [];
  const send = vi.fn(async (frame: unknown) => {
    frames.push(frame as SentFrame);
  });
  return { frames, send };
}

describe("PI isolation child tool proxy", () => {
  it("forwards calls and resolves parent updates and results", async () => {
    const { frames, send } = createSender();
    const bridge = createPiIsolationToolProxyBridge({ send });
    const onUpdate = vi.fn();
    const running = bridge
      .createTool(createDescriptor())
      .execute("call-1", { value: 7 }, undefined, onUpdate);
    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
    const callFrame = frames[0];
    expect(callFrame).toMatchObject({
      type: "tool_call",
      toolCallId: "call-1",
      toolName: "fixture",
      params: { value: 7 },
    });
    const bridgeCallId = callFrame?.bridgeCallId;
    const update = { content: [{ type: "text", text: "working" }], details: {} };
    const result = { content: [{ type: "text", text: "complete" }], details: {} };

    expect(bridge.update(bridgeCallId, update)).toBe(true);
    expect(bridge.resolve(bridgeCallId, result)).toBe(true);

    await expect(running).resolves.toEqual(result);
    expect(onUpdate).toHaveBeenCalledWith(update);
    expect(bridge.resolve(bridgeCallId, result)).toBe(false);
  });

  it("propagates parent errors and rejects every pending call on shutdown", async () => {
    const { frames, send } = createSender();
    const bridge = createPiIsolationToolProxyBridge({ send });
    const first = bridge.createTool(createDescriptor()).execute("call-1", {}, undefined);
    const second = bridge.createTool(createDescriptor()).execute("call-2", {}, undefined);
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    const firstId = frames[0]?.bridgeCallId;
    const remoteError = new Error("remote tool failed");
    expect(bridge.reject(firstId, remoteError)).toBe(true);
    await expect(first).rejects.toBe(remoteError);

    const shutdownError = new Error("child shutdown");
    bridge.rejectAll(shutdownError);
    await expect(second).rejects.toBe(shutdownError);
  });

  it("sends tool_abort when an in-flight call is cancelled", async () => {
    const { frames, send } = createSender();
    const bridge = createPiIsolationToolProxyBridge({ send });
    const controller = new AbortController();
    const running = bridge.createTool(createDescriptor()).execute("call-1", {}, controller.signal);
    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
    const bridgeCallId = frames[0]?.bridgeCallId;

    controller.abort(new Error("cancel tool"));

    await expect(running).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() =>
      expect(send).toHaveBeenLastCalledWith({ type: "tool_abort", bridgeCallId }),
    );
    expect(
      bridge.resolve(bridgeCallId, {
        content: [],
        details: {},
      } satisfies AgentToolResult<unknown>),
    ).toBe(false);
  });
});
