import { describe, expect, it, vi } from "vitest";
import { createEmbeddedAttemptTools } from "./attempt-tools.js";
import type { EmbeddedRunAttemptParams } from "./types.js";

describe("embedded attempt tools", () => {
  it("limits the tool surface to the attempt allowlist", () => {
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
});
