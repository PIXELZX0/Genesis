import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EmbeddedRunAttemptParams } from "../pi-embedded-runner/run/types.js";

const mocks = vi.hoisted(() => ({
  resolvePiIsolationStaticCompatibility: vi.fn(),
  clonePiIsolationAttempt: vi.fn(),
  resolvePiIsolationToolCompatibility: vi.fn(),
  createPiIsolationToolHost: vi.fn(),
  runIsolatedPiAttempt: vi.fn(),
  runEmbeddedAttempt: vi.fn(),
}));

vi.mock("../pi-embedded-runner/isolation/compatibility.js", () => ({
  resolvePiIsolationStaticCompatibility: mocks.resolvePiIsolationStaticCompatibility,
  clonePiIsolationAttempt: mocks.clonePiIsolationAttempt,
  resolvePiIsolationToolCompatibility: mocks.resolvePiIsolationToolCompatibility,
}));

vi.mock("../pi-embedded-runner/isolation/parent.js", async () => {
  const actual = await vi.importActual<typeof import("../pi-embedded-runner/isolation/parent.js")>(
    "../pi-embedded-runner/isolation/parent.js",
  );
  return {
    PiIsolatedProcessError: actual.PiIsolatedProcessError,
    runIsolatedPiAttempt: mocks.runIsolatedPiAttempt,
  };
});

vi.mock("../pi-embedded-runner/isolation/tool-host.js", async () => {
  const actual = await vi.importActual<
    typeof import("../pi-embedded-runner/isolation/tool-host.js")
  >("../pi-embedded-runner/isolation/tool-host.js");
  return {
    PiIsolationToolContractError: actual.PiIsolationToolContractError,
    createPiIsolationToolHost: mocks.createPiIsolationToolHost,
  };
});

vi.mock("../pi-embedded-runner/run/attempt.js", () => ({
  runEmbeddedAttempt: mocks.runEmbeddedAttempt,
}));

const { createPiAgentHarness } = await import("./builtin-pi.js");
const { PiIsolatedProcessError } = await import("../pi-embedded-runner/isolation/parent.js");

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
    authStorage: { getApiKey: vi.fn(async () => "sk-test") } as never,
    modelRegistry: {} as never,
    thinkLevel: "off",
    disableTools: true,
    ...overrides,
  } as EmbeddedRunAttemptParams;
}

function createToolHost() {
  return {
    abortController: new AbortController(),
    trace: { traceId: "1", spanId: "2", traceFlags: "01" },
    descriptors: [],
    sandboxEnabled: false,
    hasArgumentAdapter: false,
    execute: vi.fn(async () => ({ content: [{ type: "text", text: "ok" }], details: {} })),
  };
}

describe("createPiAgentHarness", () => {
  const originalEnv = process.env.GENESIS_PI_ISOLATION;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolvePiIsolationStaticCompatibility.mockReturnValue({ compatible: true });
    mocks.clonePiIsolationAttempt.mockReturnValue({ ok: true, attempt: {} });
    mocks.resolvePiIsolationToolCompatibility.mockReturnValue({ compatible: true });
    mocks.createPiIsolationToolHost.mockResolvedValue(createToolHost());
    delete process.env.GENESIS_PI_ISOLATION;
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.GENESIS_PI_ISOLATION;
    } else {
      process.env.GENESIS_PI_ISOLATION = originalEnv;
    }
  });

  it("falls back in-process with code=disabled when GENESIS_PI_ISOLATION=0", async () => {
    process.env.GENESIS_PI_ISOLATION = "0";
    mocks.runEmbeddedAttempt.mockResolvedValue({ assistantTexts: ["in-process"] });

    const harness = createPiAgentHarness();
    const result = await harness.runAttempt(createAttempt());

    expect(mocks.runEmbeddedAttempt).toHaveBeenCalledOnce();
    expect(mocks.resolvePiIsolationStaticCompatibility).not.toHaveBeenCalled();
    expect(result.piIsolation).toMatchObject({ mode: "in-process", fallbackCode: "disabled" });
  });

  it("falls back on static incompatibility before creating a tool host", async () => {
    mocks.resolvePiIsolationStaticCompatibility.mockReturnValue({
      compatible: false,
      code: "sandbox_tool_contract",
      reason: "sandbox filesystem bridges are process-local",
    });
    mocks.runEmbeddedAttempt.mockResolvedValue({ assistantTexts: ["in-process"] });

    const harness = createPiAgentHarness();
    const result = await harness.runAttempt(createAttempt());

    expect(mocks.clonePiIsolationAttempt).not.toHaveBeenCalled();
    expect(mocks.createPiIsolationToolHost).not.toHaveBeenCalled();
    expect(mocks.runEmbeddedAttempt).toHaveBeenCalledOnce();
    expect(result.piIsolation).toMatchObject({
      mode: "in-process",
      fallbackCode: "sandbox_tool_contract",
    });
  });

  it("falls back in-process with code=child_unavailable on a replay-safe isolation error", async () => {
    const toolHost = createToolHost();
    mocks.createPiIsolationToolHost.mockResolvedValue(toolHost);
    mocks.runIsolatedPiAttempt.mockRejectedValue(
      new PiIsolatedProcessError("spawn", "child unavailable", { replaySafe: true }),
    );
    mocks.runEmbeddedAttempt.mockResolvedValue({ assistantTexts: ["in-process fallback"] });

    const harness = createPiAgentHarness();
    const result = await harness.runAttempt(createAttempt());

    expect(toolHost.abortController.signal.aborted).toBe(true);
    expect(mocks.runEmbeddedAttempt).toHaveBeenCalledOnce();
    expect(result.piIsolation).toMatchObject({
      mode: "in-process",
      fallbackCode: "child_unavailable",
    });
  });

  it("rethrows a replay-unsafe isolation error instead of falling back", async () => {
    mocks.runIsolatedPiAttempt.mockRejectedValue(
      new PiIsolatedProcessError("exit", "child crashed mid-turn", { replaySafe: false }),
    );

    const harness = createPiAgentHarness();

    await expect(harness.runAttempt(createAttempt())).rejects.toThrow("child crashed mid-turn");
    expect(mocks.runEmbeddedAttempt).not.toHaveBeenCalled();
  });
});
