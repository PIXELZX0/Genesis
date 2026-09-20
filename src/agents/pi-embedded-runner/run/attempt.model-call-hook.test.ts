import type { StreamFn } from "@earendil-works/pi-agent-core";
import { getCurrentTools, normalizeContext } from "@earendil-works/pi-ai";
import { describe, expect, it, vi } from "vitest";
import type { PluginHookBeforeModelCallResult } from "../../../plugins/hook-types.js";
import {
  applyModelCallRoute,
  wrapStreamFnWithBeforeModelCallHook,
} from "./attempt.model-call-hook.js";

type Model = Parameters<StreamFn>[0];
type Context = Parameters<StreamFn>[1];

const anthropicModel = { api: "anthropic-messages", provider: "anthropic", id: "claude" } as Model;
const context = normalizeContext({
  systemPrompt: "sys",
  messages: [],
  tools: [
    { name: "read", description: "Read a file", parameters: {} },
    { name: "browser", description: "Control the browser", parameters: {} },
  ],
} as unknown as Parameters<typeof normalizeContext>[0]);

function setup(route: PluginHookBeforeModelCallResult | Error | undefined) {
  const inner = vi.fn((() => "inner-stream") as unknown as StreamFn);
  const runBeforeModelCall = vi.fn(async (_event: unknown, _ctx: unknown) => {
    if (route instanceof Error) {
      throw route;
    }
    return route;
  });
  const wrapped = wrapStreamFnWithBeforeModelCallHook(inner, {
    hookRunner: { hasHooks: () => true, runBeforeModelCall },
    runId: "run-1",
    sessionId: "session-1",
    hookCtx: { runId: "run-1" },
  });
  return { inner, wrapped, runBeforeModelCall };
}

describe("wrapStreamFnWithBeforeModelCallHook", () => {
  it("returns the inner stream fn when no hook is registered", () => {
    const inner = vi.fn() as unknown as StreamFn;
    const wrapped = wrapStreamFnWithBeforeModelCallHook(inner, {
      hookRunner: { hasHooks: () => false, runBeforeModelCall: vi.fn() },
      runId: "run-1",
      sessionId: "session-1",
      hookCtx: {},
    });
    expect(wrapped).toBe(inner);
  });

  it("passes tools and messages to the hook and calls the model on pass", async () => {
    const { inner, wrapped, runBeforeModelCall } = setup({ action: "pass" });
    await expect(wrapped(anthropicModel, context, { reasoning: "high" })).resolves.toBe(
      "inner-stream",
    );
    expect(runBeforeModelCall.mock.calls[0]?.[0]).toMatchObject({
      runId: "run-1",
      api: "anthropic-messages",
      tools: [{ name: "read" }, { name: "browser" }],
    });
    expect(inner).toHaveBeenCalledWith(anthropicModel, context, { reasoning: "high" });
  });

  it("falls back to the unchanged call when the hook throws or names an unknown tool", async () => {
    for (const route of [
      new Error("boom"),
      { action: "force_tool", toolName: "missing" } as const,
    ]) {
      const { inner, wrapped } = setup(route);
      await wrapped(anthropicModel, context, undefined);
      expect(inner).toHaveBeenCalledWith(anthropicModel, context, undefined);
    }
  });

  it("forces the named tool and disables anthropic thinking", async () => {
    const { inner, wrapped } = setup({ action: "force_tool", toolName: "browser" });
    await wrapped(anthropicModel, context, { reasoning: "high" });
    expect(inner.mock.calls[0]?.[2]).toMatchObject({
      toolChoice: { type: "tool", name: "browser" },
      reasoning: undefined,
    });
  });

  it("keeps anthropic thinking off for the rest of a routed tool loop", async () => {
    const routes: PluginHookBeforeModelCallResult[] = [
      { action: "tool_call", toolName: "read", arguments: {} },
      { action: "pass" },
      { action: "pass" },
    ];
    const inner = vi.fn((() => "inner-stream") as unknown as StreamFn);
    const wrapped = wrapStreamFnWithBeforeModelCallHook(inner, {
      hookRunner: { hasHooks: () => true, runBeforeModelCall: async () => routes.shift() },
      runId: "run-1",
      sessionId: "session-1",
      hookCtx: {},
    });
    const withLast = (role: string) =>
      ({ ...context, messages: [...context.messages, { role }] }) as unknown as Context;
    await wrapped(anthropicModel, withLast("user"), { reasoning: "high" });
    await wrapped(anthropicModel, withLast("toolResult"), { reasoning: "high" });
    await wrapped(anthropicModel, withLast("user"), { reasoning: "high" });
    expect(inner.mock.calls.map((call) => call[2]?.reasoning)).toEqual([undefined, "high"]);
  });

  it("executes tool_call routes without calling the model", async () => {
    const { inner, wrapped } = setup({
      action: "tool_call",
      toolName: "browser",
      arguments: { action: "snapshot" },
    });
    const stream = await wrapped(anthropicModel, context, undefined);
    const events = [];
    for await (const event of stream) {
      events.push(event.type);
    }
    const message = await stream.result();
    expect(inner).not.toHaveBeenCalled();
    expect(events).toEqual(["start", "toolcall_start", "toolcall_end", "done"]);
    expect(message.stopReason).toBe("toolUse");
    expect(message.content).toEqual([
      expect.objectContaining({
        type: "toolCall",
        name: "browser",
        arguments: { action: "snapshot" },
      }),
    ]);
  });
});

describe("applyModelCallRoute", () => {
  it("maps forced tool choice per transport", () => {
    const force = { action: "force_tool", toolName: "read" } as const;
    const choiceFor = (api: string) =>
      (
        applyModelCallRoute({
          model: { ...anthropicModel, api } as Model,
          context,
          options: {},
          route: force,
        })?.options as { toolChoice?: unknown }
      ).toolChoice;
    expect(choiceFor("openai-completions")).toEqual({
      type: "function",
      function: { name: "read" },
    });
    expect(choiceFor("openai-responses")).toEqual({ type: "function", name: "read" });
  });

  it("narrows tools on transports without named tool choice", () => {
    const applied = applyModelCallRoute({
      model: { ...anthropicModel, api: "google-generative-ai" } as Model,
      context,
      options: {},
      route: { action: "force_tool", toolName: "read" },
    });
    expect(getCurrentTools(applied?.context.messages ?? []).map((tool) => tool.name)).toEqual([
      "read",
    ]);
  });

  it("disables tools with tool_choice none, or skips when unsupported", () => {
    const route = { action: "no_tools" } as const;
    expect(
      applyModelCallRoute({ model: anthropicModel, context, options: {}, route })?.options,
    ).toMatchObject({ toolChoice: "none" });
    expect(
      applyModelCallRoute({
        model: { ...anthropicModel, api: "google-generative-ai" } as Model,
        context,
        options: {},
        route,
      }),
    ).toBeUndefined();
  });
});
