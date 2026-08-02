import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { coerceToFailoverError } from "../../failover-error.js";
import {
  createPiIsolationJsonlDecoder,
  deserializePiIsolationError,
  deserializePiIsolationAttemptResult,
  parsePiIsolationBridgedHookNames,
  PI_ISOLATION_PROTOCOL,
  PI_ISOLATION_PROTOCOL_VERSION,
  PiIsolationJsonlWriter,
  PiIsolationProtocolError,
  PiIsolationSequenceGuard,
  serializePiIsolationError,
  serializePiIsolationAttemptResult,
} from "./protocol.js";

describe("PI isolation JSONL protocol", () => {
  it("parses incremental LF frames without splitting Unicode separators", () => {
    const frames: unknown[] = [];
    const errors: Error[] = [];
    const decoder = createPiIsolationJsonlDecoder({
      onFrame: (frame) => frames.push(frame),
      onError: (error) => errors.push(error),
    });
    const line = JSON.stringify({ text: "left\u2028right\u2029done" });
    const bytes = Buffer.from(`${line}\n`, "utf8");
    decoder.push(bytes.subarray(0, 7));
    decoder.push(bytes.subarray(7, -2));
    decoder.push(bytes.subarray(-2));
    decoder.end();

    expect(errors).toEqual([]);
    expect(frames).toEqual([{ text: "left\u2028right\u2029done" }]);
  });

  it("accepts CRLF but rejects partial and oversized frames", () => {
    const frames: unknown[] = [];
    const errors: Error[] = [];
    const decoder = createPiIsolationJsonlDecoder({
      maxFrameBytes: 16,
      onFrame: (frame) => frames.push(frame),
      onError: (error) => errors.push(error),
    });
    decoder.push('{"ok":true}\r\n');
    decoder.push('{"tooLong":"1234567890"}');

    expect(frames).toEqual([{ ok: true }]);
    expect(errors[0]).toBeInstanceOf(PiIsolationProtocolError);
    expect(errors[0]?.message).toContain("size limit");
  });

  it("deduplicates old sequences and rejects gaps", () => {
    const guard = new PiIsolationSequenceGuard();
    expect(guard.accept(1)).toBe("accepted");
    expect(guard.accept(1)).toBe("duplicate");
    expect(() => guard.accept(3)).toThrow("expected 2, received 3");
  });

  it("accepts only unique bridged hook names", () => {
    expect(parsePiIsolationBridgedHookNames(["before_prompt_build", "agent_end"])).toEqual([
      "before_prompt_build",
      "agent_end",
    ]);
    expect(() => parsePiIsolationBridgedHookNames(["llm_input"])).toThrow("invalid hook names");
    expect(() => parsePiIsolationBridgedHookNames(["agent_end", "agent_end"])).toThrow(
      "duplicate hook names",
    );
  });

  it("writes versioned frames in sequence and enforces frame bounds", async () => {
    const stream = new PassThrough();
    const chunks: Buffer[] = [];
    stream.on("data", (chunk: Buffer) => chunks.push(chunk));
    const writer = new PiIsolationJsonlWriter(stream, { maxFrameBytes: 256 });
    await writer.send({ type: "first", value: 1 });
    await writer.send({ type: "second", value: 2 });

    const frames = Buffer.concat(chunks)
      .toString("utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(frames).toMatchObject([
      {
        protocol: PI_ISOLATION_PROTOCOL,
        version: PI_ISOLATION_PROTOCOL_VERSION,
        seq: 1,
        type: "first",
      },
      {
        protocol: PI_ISOLATION_PROTOCOL,
        version: PI_ISOLATION_PROTOCOL_VERSION,
        seq: 2,
        type: "second",
      },
    ]);

    const tinyWriter = new PiIsolationJsonlWriter(new PassThrough(), { maxFrameBytes: 8 });
    await expect(tinyWriter.send({ type: "oversized" })).rejects.toThrow("size limit");

    await expect(writer.send({ type: "invalid", value: 1n })).rejects.toThrow(
      "not JSON serializable",
    );
  });

  it("reports malformed JSON exactly once", () => {
    const onError = vi.fn();
    const decoder = createPiIsolationJsonlDecoder({ onFrame: vi.fn(), onError });
    decoder.push("not-json\n");
    decoder.push("also-not-json\n");
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("preserves bounded failover fields and nested provider errors", () => {
    const source = Object.assign(new Error("request failed"), {
      reason: "rate_limit",
      provider: "openai",
      model: "gpt-5.4",
      profileId: "openai:default",
      rawError: "upstream 429",
      statusCode: "429",
      error: {
        name: "ProviderError",
        message: "rate limited",
        status: 429,
        code: "rate_limit_exceeded",
      },
    });

    const restored = deserializePiIsolationError(serializePiIsolationError(source)) as Error & {
      reason?: string;
      provider?: string;
      model?: string;
      profileId?: string;
      rawError?: string;
      statusCode?: number | string;
      error?: Error & { status?: number | string; code?: string };
    };

    expect(restored).toMatchObject({
      name: "Error",
      message: "request failed",
      reason: "rate_limit",
      provider: "openai",
      model: "gpt-5.4",
      profileId: "openai:default",
      rawError: "upstream 429",
      statusCode: "429",
    });
    expect(restored.error).toMatchObject({
      name: "ProviderError",
      message: "rate limited",
      status: 429,
      code: "rate_limit_exceeded",
    });
    expect(coerceToFailoverError(restored)?.reason).toBe("rate_limit");
  });

  it("keeps function-bearing lifecycle controls out of result frames", () => {
    const wire = serializePiIsolationAttemptResult({
      aborted: false,
      externalAbort: false,
      timedOut: false,
      idleTimedOut: false,
      timedOutDuringCompaction: false,
      promptError: new Error("fixture error"),
      promptErrorSource: "prompt",
      sessionIdUsed: "session-1",
      messagesSnapshot: [],
      assistantTexts: [],
      toolMetas: [],
      lastAssistant: undefined,
      didSendViaMessagingTool: false,
      messagingToolSentTexts: [],
      messagingToolSentMediaUrls: [],
      messagingToolSentTargets: [],
      cloudCodeAssistFormatError: false,
      replayMetadata: { hadPotentialSideEffects: false, replaySafe: true },
      itemLifecycle: { startedCount: 0, completedCount: 0, activeCount: 0 },
      setTerminalLifecycleMeta: vi.fn(),
      flushTerminalLifecycleEvent: vi.fn(),
    });

    expect(wire).not.toHaveProperty("setTerminalLifecycleMeta");
    expect(wire).not.toHaveProperty("flushTerminalLifecycleEvent");
    expect(deserializePiIsolationAttemptResult(wire).promptError).toMatchObject({
      name: "Error",
      message: "fixture error",
    });
  });
});
