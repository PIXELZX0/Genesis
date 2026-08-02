import { describe, expect, it, vi } from "vitest";
import type { AnyAgentTool } from "../../tools/common.js";
import { createSessionsYieldTool } from "../../tools/sessions-yield-tool.js";
import { createEmbeddedAttemptTools, materializeIsolatedAttemptTools } from "./attempt-tools.js";
import type { EmbeddedRunAttemptParams } from "./types.js";

function stubTool(name: string, execute = vi.fn()): AnyAgentTool {
  return {
    name,
    label: name,
    description: `${name} fixture`,
    parameters: { type: "object" } as never,
    execute,
  };
}

describe("isolated embedded attempt tools", () => {
  it("constructs the requested child-local sessions_yield tool without the full surface", () => {
    const attempt = {
      sessionId: "session-1",
      runId: "run-1",
      sessionFile: "session.jsonl",
      workspaceDir: process.cwd(),
      agentDir: process.cwd(),
      provider: "openai",
      modelId: "fixture-model",
      model: { provider: "openai", id: "fixture-model", api: "openai-completions" },
      authStorage: {},
      modelRegistry: {},
      thinkLevel: "off",
      disableTools: false,
      toolsAllow: ["sessions_yield"],
    } as unknown as EmbeddedRunAttemptParams;
    const onYield = vi.fn();
    const tools = createEmbeddedAttemptTools({
      attempt,
      context: {
        resolvedWorkspace: process.cwd(),
        effectiveWorkspace: process.cwd(),
        sandboxSessionKey: "session-1",
        sandbox: null,
        sessionAgentId: "main",
        agentDir: process.cwd(),
      },
      abortSignal: new AbortController().signal,
      trace: {
        traceId: "11111111111111111111111111111111",
        spanId: "2222222222222222",
        traceFlags: "01",
      },
      onYield,
      toolAllowlist: attempt.toolsAllow,
    });

    expect(tools.map((tool) => tool.name)).toEqual(["sessions_yield"]);
  });

  it("replaces the sessions_yield proxy in place with child-local parity behavior", async () => {
    const proxyExecute = vi.fn(async () => ({ content: [], details: {} }));
    const onYield = vi.fn();
    const tools = [stubTool("read"), stubTool("sessions_yield", proxyExecute), stubTool("write")];
    const materialized = materializeIsolatedAttemptTools({
      tools,
      localToolNames: ["sessions_yield"],
      sessionId: "session-1",
      onYield,
    });

    expect(materialized.map((tool) => tool.name)).toEqual(["read", "sessions_yield", "write"]);
    const localYield = materialized[1];
    expect(localYield?.description).toBe("sessions_yield fixture");
    const actual = await localYield?.execute(
      "call-1",
      { message: "Waiting for child work" },
      undefined,
      undefined,
    );
    const expectedOnYield = vi.fn();
    const expected = await createSessionsYieldTool({
      sessionId: "session-1",
      onYield: expectedOnYield,
    }).execute("call-1", { message: "Waiting for child work" }, undefined, undefined);

    expect(actual).toEqual(expected);
    expect(onYield).toHaveBeenCalledWith("Waiting for child work");
    expect(expectedOnYield).toHaveBeenCalledWith("Waiting for child work");
    expect(proxyExecute).not.toHaveBeenCalled();
  });

  it("creates sessions_yield locally when the bridge advertises it without a proxy", () => {
    const tools = [stubTool("read")];
    const materialized = materializeIsolatedAttemptTools({
      tools,
      localToolNames: ["sessions_yield"],
      sessionId: "session-1",
      onYield: vi.fn(),
    });

    expect(materialized.map((tool) => tool.name)).toEqual(["read", "sessions_yield"]);
  });
});
