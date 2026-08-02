import fs from "node:fs";
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HookRunner } from "../../../plugins/hooks.js";
import { resolveUserPath } from "../../../utils.js";
import type { EmbeddedRunAttemptParams } from "../run/types.js";
import { PiIsolatedProcessError, runIsolatedPiAttempt } from "./parent.js";
import type { PiIsolationToolHost } from "./tool-host.js";

const mocks = vi.hoisted(() => ({
  resolveLaunch: vi.fn(),
}));

vi.mock("./launch.js", () => ({
  resolvePiIsolationChildLaunch: mocks.resolveLaunch,
  createPiIsolationSpawnEnvironment: () => process.env,
  createPiIsolationRuntimeEnvironment: () => ({}),
}));

const fixturePids = new Set<number>();
const fixtureTrace = {
  traceId: "11111111111111111111111111111111",
  spanId: "2222222222222222",
  traceFlags: "01",
};

function createToolResult(text: string): AgentToolResult<unknown> {
  return { content: [{ type: "text", text }], details: {} };
}

function createFixtureScript(handleFrameBody: string, setup = ""): string {
  return `
const protocol = "genesis.pi-isolation";
let sequence = 1;
let input = "";
const send = (payload) => process.stdout.write(JSON.stringify({ protocol, version: 1, seq: sequence++, ...payload }) + "\\n");
const finish = (result) => {
  send({ type: "state", streaming: false, compacting: false });
  send({ type: "result", result });
  process.stdin.destroy();
  process.stdout.end(() => process.exit(0));
};
const result = (overrides = {}) => ({
  aborted: false,
  externalAbort: false,
  timedOut: false,
  idleTimedOut: false,
  timedOutDuringCompaction: false,
  promptError: null,
  promptErrorSource: null,
  sessionIdUsed: "session-1",
  messagesSnapshot: [],
  assistantTexts: ["fixture ok"],
  toolMetas: [],
  didSendViaMessagingTool: false,
  messagingToolSentTexts: [],
  messagingToolSentMediaUrls: [],
  messagingToolSentTargets: [],
  cloudCodeAssistFormatError: false,
  replayMetadata: {},
  itemLifecycle: { startedCount: 0, completedCount: 0, activeCount: 0 },
  ...overrides,
});
${setup}
const handleFrame = (frame) => {
${handleFrameBody}
};
process.stdout.write(JSON.stringify({
  protocol,
  version: 1,
  seq: 0,
  type: "hello",
  role: "child",
  pid: process.pid,
  capabilities: ["callbacks", "tool-bridge", "abort", "steer"],
}) + "\\n");
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  input += chunk;
  while (true) {
    const newline = input.indexOf("\\n");
    if (newline < 0) break;
    const line = input.slice(0, newline);
    input = input.slice(newline + 1);
    if (line) handleFrame(JSON.parse(line));
  }
});
`;
}

function useFixture(script: string): void {
  mocks.resolveLaunch.mockReturnValue({
    command: process.execPath,
    args: ["-e", script],
    entryPath: "[eval]",
    source: false,
  });
}

function createAttempt(
  overrides: Partial<EmbeddedRunAttemptParams> = {},
): EmbeddedRunAttemptParams {
  return {
    sessionId: "session-1",
    runId: "run-1",
    sessionFile: "session.jsonl",
    workspaceDir: process.cwd(),
    agentDir: process.cwd(),
    prompt: "hello",
    timeoutMs: 5_000,
    provider: "openai",
    modelId: "fixture-model",
    model: { provider: "openai", id: "fixture-model" } as never,
    authStorage: { getApiKey: vi.fn(async () => "sk-parent-test") } as never,
    modelRegistry: {} as never,
    thinkLevel: "off",
    disableTools: true,
    ...overrides,
  };
}

function createToolHost(overrides: Partial<PiIsolationToolHost> = {}): PiIsolationToolHost {
  return {
    abortController: new AbortController(),
    trace: fixtureTrace,
    descriptors: [],
    sandboxEnabled: false,
    hasArgumentAdapter: false,
    execute: vi.fn(async () => createToolResult("tool ok")),
    ...overrides,
  };
}

function rememberFixturePid(stderr?: string): number | undefined {
  const match = stderr?.match(/fixture-pid=(\d+)/u);
  const pid = match ? Number(match[1]) : undefined;
  if (pid) {
    fixturePids.add(pid);
  }
  return pid;
}

beforeEach(() => {
  mocks.resolveLaunch.mockReset();
});

afterEach(() => {
  for (const pid of fixturePids) {
    try {
      process.kill(process.platform === "win32" ? pid : -pid, "SIGKILL");
    } catch {
      // The fixture already exited.
    }
  }
  fixturePids.clear();
});

describe("PI isolation parent", () => {
  it("bridges acknowledged callbacks and parent-owned tool execution", async () => {
    useFixture(
      createFixtureScript(`
  if (frame.type === "start") {
    if (frame.runtimeApiKey !== "sk-parent-test") process.exit(18);
    if (frame.trace?.traceId !== "11111111111111111111111111111111") process.exit(19);
    send({ type: "ready", pid: process.pid });
    send({ type: "state", streaming: true, compacting: false });
    send({ type: "callback", callbackId: "callback-1", callback: "partial_reply", payload: { text: "partial" } });
    return;
  }
  if (frame.type === "callback_result" && frame.callbackId === "callback-1") {
    send({ type: "tool_call", bridgeCallId: "bridge-1", toolCallId: "call-1", toolName: "fixture", params: { value: 7 } });
    return;
  }
  if (frame.type === "tool_result" && frame.bridgeCallId === "bridge-1") {
    send({ type: "callback", callbackId: "callback-2", callback: "agent_event", payload: { stream: "lifecycle", data: { phase: "end" } } });
    return;
  }
  if (frame.type === "callback_result" && frame.callbackId === "callback-2") {
    finish(result());
  }
`),
    );
    const onPartialReply = vi.fn(async () => undefined);
    const onAgentEvent = vi.fn();
    const execute = vi.fn(async ({ onUpdate }: Parameters<PiIsolationToolHost["execute"]>[0]) => {
      onUpdate(createToolResult("working"));
      return createToolResult("tool ok");
    });
    const toolHost = createToolHost({
      descriptors: [
        { name: "fixture", label: "Fixture", description: "", parameters: { type: "object" } },
      ],
      execute,
    });

    const value = await runIsolatedPiAttempt({
      attempt: createAttempt({ onPartialReply, onAgentEvent }),
      wireAttempt: { sessionId: "session-1" },
      toolHost,
      handshakeTimeoutMs: 1_000,
      processTimeoutMs: 5_000,
    });

    expect(value.assistantTexts).toEqual(["fixture ok"]);
    expect(value.piIsolation).toMatchObject({ mode: "isolated", protocolVersion: 1 });
    expect(onPartialReply).toHaveBeenCalledWith({ text: "partial" });
    expect(onAgentEvent).not.toHaveBeenCalled();
    value.setTerminalLifecycleMeta?.({ replayInvalid: true, livenessState: "blocked" });
    await value.flushTerminalLifecycleEvent?.();
    expect(onAgentEvent).toHaveBeenCalledWith({
      stream: "lifecycle",
      data: { phase: "end", replayInvalid: true, livenessState: "blocked" },
    });
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: "fixture",
        toolCallId: "call-1",
        toolParams: { value: 7 },
      }),
    );
    expect(toolHost.abortController.signal.aborted).toBe(true);
  });

  it("bridges active prompt and end hooks through the parent HookRunner", async () => {
    useFixture(
      createFixtureScript(`
  if (frame.type === "start") {
    if (JSON.stringify(frame.hookNames) !== JSON.stringify(["before_prompt_build", "agent_end"])) process.exit(20);
    send({ type: "ready", pid: process.pid });
    send({
      type: "hook_request",
      requestId: "hook-1",
      hookName: "before_prompt_build",
      event: { prompt: "hello", messages: [{ role: "user", content: "history" }] },
      context: { runId: "run-1", sessionId: "session-1" },
    });
    return;
  }
  if (frame.type === "hook_result" && frame.requestId === "hook-1") {
    if (frame.result?.prependContext !== "parent context") process.exit(21);
    if (frame.result?.appendSystemContext !== "parent system suffix") process.exit(22);
    send({
      type: "hook_notification",
      hookName: "agent_end",
      event: {
        messages: [{ role: "assistant", content: "done" }],
        newMessages: [{ role: "assistant", content: "done" }],
        success: true,
      },
      context: { runId: "run-1", sessionId: "session-1" },
    });
    finish(result());
  }
`),
    );
    const runBeforePromptBuild = vi.fn(async () => ({
      prependContext: "parent context",
      appendSystemContext: "parent system suffix",
    }));
    let releaseAgentEnd: (() => void) | undefined;
    const agentEndPending = new Promise<void>((resolve) => {
      releaseAgentEnd = resolve;
    });
    const runAgentEnd = vi.fn(() => agentEndPending);
    const hookRunner = {
      hasHooks: (hookName: string) =>
        hookName === "before_prompt_build" || hookName === "agent_end",
      runBeforePromptBuild,
      runAgentEnd,
    } as unknown as HookRunner;

    const value = await runIsolatedPiAttempt({
      attempt: createAttempt(),
      wireAttempt: {
        sessionId: "session-1",
        provider: "openai",
        workspaceDir: process.cwd(),
        config: {},
        model: { provider: "openai", id: "fixture-model" },
      },
      toolHost: createToolHost(),
      hookRunner,
      handshakeTimeoutMs: 1_000,
      processTimeoutMs: 5_000,
    });

    expect(value.assistantTexts).toEqual(["fixture ok"]);
    expect(runBeforePromptBuild).toHaveBeenCalledWith(
      { prompt: "hello", messages: [{ role: "user", content: "history" }] },
      { runId: "run-1", sessionId: "session-1" },
    );
    await vi.waitFor(() => expect(runAgentEnd).toHaveBeenCalledOnce());
    expect(runAgentEnd).toHaveBeenCalledWith(
      {
        messages: [{ role: "assistant", content: "done" }],
        newMessages: [{ role: "assistant", content: "done" }],
        success: true,
      },
      { runId: "run-1", sessionId: "session-1" },
    );
    releaseAgentEnd?.();
    await agentEndPending;
  });

  it("forwards external abort and accepts the child's aborted result", async () => {
    useFixture(
      createFixtureScript(`
  if (frame.type === "start") {
    send({ type: "ready", pid: process.pid });
    send({ type: "state", streaming: true, compacting: false });
    return;
  }
  if (frame.type === "abort") {
    finish(result({ aborted: true, externalAbort: true, assistantTexts: [] }));
  }
`),
    );
    const abortController = new AbortController();
    let signalReady: (() => void) | undefined;
    const ready = new Promise<void>((resolve) => {
      signalReady = resolve;
    });
    const replyOperation = {
      attachBackend: vi.fn(() => signalReady?.()),
      detachBackend: vi.fn(),
    };
    const running = runIsolatedPiAttempt({
      attempt: createAttempt({
        abortSignal: abortController.signal,
        replyOperation: replyOperation as never,
      }),
      wireAttempt: { sessionId: "session-1" },
      toolHost: createToolHost(),
      handshakeTimeoutMs: 1_000,
      processTimeoutMs: 5_000,
    });

    await ready;
    abortController.abort(new Error("stop fixture"));
    const value = await running;

    expect(value).toMatchObject({ aborted: true, externalAbort: true });
    expect(replyOperation.detachBackend).toHaveBeenCalledOnce();
  });

  it("returns a typed process error when the child crashes", async () => {
    useFixture(
      createFixtureScript(`
  if (frame.type === "start") {
    send({ type: "ready", pid: process.pid });
    process.stderr.write("fixture crash\\n");
    setTimeout(() => process.exit(17), 10);
  }
`),
    );

    const error = await runIsolatedPiAttempt({
      attempt: createAttempt(),
      wireAttempt: { sessionId: "session-1" },
      toolHost: createToolHost(),
      handshakeTimeoutMs: 1_000,
      processTimeoutMs: 5_000,
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(PiIsolatedProcessError);
    expect(error).toMatchObject({ kind: "exit", exitCode: 17, replaySafe: false });
    expect((error as PiIsolatedProcessError).stderr).toContain("fixture crash");
  });

  it("rejects child frames sent before the ready boundary", async () => {
    useFixture(
      createFixtureScript(`
  if (frame.type === "start") {
    send({ type: "state", streaming: true, compacting: false });
  }
`),
    );

    const error = await runIsolatedPiAttempt({
      attempt: createAttempt(),
      wireAttempt: { sessionId: "session-1" },
      toolHost: createToolHost(),
      handshakeTimeoutMs: 1_000,
      processTimeoutMs: 5_000,
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(PiIsolatedProcessError);
    expect(error).toMatchObject({ kind: "protocol", replaySafe: true });
    expect((error as Error).message).toContain("before ready");
  });

  it("rejects attempts to route child-local sessions_yield through the parent proxy", async () => {
    useFixture(
      createFixtureScript(`
  if (frame.type === "start") {
    send({ type: "ready", pid: process.pid });
    send({
      type: "tool_call",
      bridgeCallId: "bridge-yield",
      toolCallId: "call-yield",
      toolName: "sessions_yield",
      params: { message: "wait" },
    });
  }
`),
    );
    const toolHost = createToolHost();

    const error = await runIsolatedPiAttempt({
      attempt: createAttempt(),
      wireAttempt: { sessionId: "session-1" },
      toolHost,
      handshakeTimeoutMs: 1_000,
      processTimeoutMs: 5_000,
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(PiIsolatedProcessError);
    expect(error).toMatchObject({ kind: "protocol", replaySafe: false });
    expect((error as Error).message).toContain("child-local sessions_yield");
    expect(toolHost.execute).not.toHaveBeenCalled();
  });

  it("force-kills a child that ignores graceful deadline termination", async () => {
    useFixture(
      createFixtureScript(
        `
  if (frame.type === "start") {
    send({ type: "ready", pid: process.pid });
    send({ type: "state", streaming: true, compacting: false });
  }
`,
        `
process.stderr.write("fixture-pid=" + process.pid + "\\n");
process.on("SIGTERM", () => undefined);
setInterval(() => undefined, 1_000);
`,
      ),
    );

    const error = await runIsolatedPiAttempt({
      attempt: createAttempt(),
      wireAttempt: { sessionId: "session-1" },
      toolHost: createToolHost(),
      handshakeTimeoutMs: 1_000,
      processTimeoutMs: 50,
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(PiIsolatedProcessError);
    expect(error).toMatchObject({ kind: "timeout", replaySafe: false });
    const pid = rememberFixturePid((error as PiIsolatedProcessError).stderr);
    expect(pid).toBeTypeOf("number");

    expect(() => process.kill(pid as number, 0)).toThrow();
  });

  it("does not spend the execution deadline while the child is starting", async () => {
    useFixture(
      createFixtureScript(`
  if (frame.type === "start") {
    setTimeout(() => {
      send({ type: "ready", pid: process.pid });
      finish(result({ assistantTexts: ["ready after startup"] }));
    }, 100);
  }
`),
    );

    const value = await runIsolatedPiAttempt({
      attempt: createAttempt(),
      wireAttempt: { sessionId: "session-1" },
      toolHost: createToolHost(),
      handshakeTimeoutMs: 1_000,
      startupTimeoutMs: 1_000,
      processTimeoutMs: 25,
    });

    expect(value.assistantTexts).toEqual(["ready after startup"]);
  });

  it("wraps a launch-resolution failure as a replay-safe process error", async () => {
    mocks.resolveLaunch.mockImplementation(() => {
      throw new Error("Unable to locate the Genesis package root for the PI isolation child");
    });

    const error = await runIsolatedPiAttempt({
      attempt: createAttempt(),
      wireAttempt: { sessionId: "session-1" },
      toolHost: createToolHost(),
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(PiIsolatedProcessError);
    expect(error).toMatchObject({ kind: "spawn", replaySafe: true });
    expect((error as Error).cause).toBeInstanceOf(Error);
  });

  it("normalizes a tilde workspace cwd before spawning the child", async () => {
    useFixture(
      createFixtureScript(`
  if (frame.type === "start") {
    send({ type: "ready", pid: process.pid });
    finish(result({ assistantTexts: [process.cwd()] }));
  }
`),
    );
    const expectedHome = fs.realpathSync(resolveUserPath("~"));

    const value = await runIsolatedPiAttempt({
      attempt: createAttempt({ workspaceDir: "~" }),
      wireAttempt: { sessionId: "session-1" },
      toolHost: createToolHost(),
      handshakeTimeoutMs: 1_000,
      processTimeoutMs: 5_000,
    });

    expect(value.assistantTexts?.[0]).toBe(expectedHome);
  });
});
