import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { ReplyPayload } from "../../../auto-reply/reply-payload.js";
import { emitAgentEvent } from "../../../infra/agent-events.js";
import { createSubsystemLogger } from "../../../logging/subsystem.js";
import { getGlobalHookRunner } from "../../../plugins/hook-runner-global.js";
import type { HookRunner } from "../../../plugins/hooks.js";
import { killProcessTree } from "../../../process/kill-tree.js";
import { resolveUserPath } from "../../../utils.js";
import type { BlockReplyPayload } from "../../pi-embedded-payloads.js";
import { resolveCompactionTimeoutMs } from "../compaction-safety-timeout.js";
import type { EmbeddedRunAttemptParams, EmbeddedRunAttemptResult } from "../run/types.js";
import {
  clearActiveEmbeddedRun,
  setActiveEmbeddedRun,
  type EmbeddedPiQueueHandle,
} from "../runs.js";
import { resolvePiIsolationBridgedHookNames } from "./compatibility.js";
import {
  createPiIsolationRuntimeEnvironment,
  createPiIsolationSpawnEnvironment,
  resolvePiIsolationChildLaunch,
} from "./launch.js";
import {
  assertPiIsolationFrame,
  createPiIsolationJsonlDecoder,
  deserializePiIsolationAttemptResult,
  deserializePiIsolationError,
  PI_ISOLATION_MAX_QUEUED_BYTES,
  PI_ISOLATION_PROTOCOL_VERSION,
  PiIsolationJsonlWriter,
  PiIsolationProtocolError,
  PiIsolationSequenceGuard,
  serializePiIsolationError,
  type PiIsolationChildFrame,
  type PiIsolationHelloFrame,
  type PiIsolationWireError,
} from "./protocol.js";
import type { PiIsolationToolHost } from "./tool-host.js";

const HANDSHAKE_TIMEOUT_MS = 15_000;
const STARTUP_TIMEOUT_MS = 90_000;
const ABORT_GRACE_MS = 10_000;
const PROCESS_TIMEOUT_OVERHEAD_MS = 75_000;
const STDERR_CAPTURE_BYTES = 64 * 1024;
const log = createSubsystemLogger("agents/pi-isolation");

export type PiIsolatedProcessErrorKind =
  | "spawn"
  | "handshake"
  | "startup"
  | "protocol"
  | "exit"
  | "timeout"
  | "aborted";

export class PiIsolatedProcessError extends Error {
  readonly code = "PI_ISOLATED_PROCESS";
  readonly kind: PiIsolatedProcessErrorKind;
  readonly exitCode?: number | null;
  readonly signal?: NodeJS.Signals | null;
  readonly stderr?: string;
  readonly childError?: PiIsolationWireError;
  readonly replaySafe: boolean;

  constructor(
    kind: PiIsolatedProcessErrorKind,
    message: string,
    options?: ErrorOptions & {
      exitCode?: number | null;
      signal?: NodeJS.Signals | null;
      stderr?: string;
      childError?: PiIsolationWireError;
      replaySafe?: boolean;
    },
  ) {
    super(message, options);
    this.name = "PiIsolatedProcessError";
    this.kind = kind;
    this.exitCode = options?.exitCode;
    this.signal = options?.signal;
    this.stderr = options?.stderr;
    this.childError = options?.childError;
    this.replaySafe = options?.replaySafe === true;
  }
}

type PendingControl = {
  resolve: () => void;
  reject: (error: Error) => void;
};

type RunningToolCall = {
  controller: AbortController;
  updateTail: Promise<void>;
};

type ParentCallbackState = {
  compacting: boolean;
  terminalLifecycleEvent?: {
    stream: string;
    data: Record<string, unknown>;
  };
  terminalLifecycleMeta?: Parameters<
    NonNullable<EmbeddedRunAttemptResult["setTerminalLifecycleMeta"]>
  >[0];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requireString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || !value) {
    throw new PiIsolationProtocolError(
      `PI isolation ${String(record.type)} frame is missing ${key}`,
    );
  }
  return value;
}

function requireWireError(value: unknown): PiIsolationWireError {
  if (!isRecord(value) || typeof value.name !== "string" || typeof value.message !== "string") {
    throw new PiIsolationProtocolError("PI isolation frame contains an invalid error");
  }
  return value as PiIsolationWireError;
}

function appendCapturedStderr(current: Buffer, chunk: Buffer | string): Buffer {
  const incoming = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, "utf8");
  const combined = current.length === 0 ? incoming : Buffer.concat([current, incoming]);
  return combined.length <= STDERR_CAPTURE_BYTES
    ? combined
    : combined.subarray(combined.length - STDERR_CAPTURE_BYTES);
}

function createProcessError(params: {
  kind: PiIsolatedProcessErrorKind;
  message: string;
  child?: ChildProcessWithoutNullStreams;
  stderr: Buffer;
  cause?: unknown;
  childError?: PiIsolationWireError;
  exitCode?: number | null;
  signal?: NodeJS.Signals | null;
  replaySafe: boolean;
}): PiIsolatedProcessError {
  const stderr = params.stderr.toString("utf8").trim();
  return new PiIsolatedProcessError(params.kind, params.message, {
    ...(params.cause !== undefined ? { cause: params.cause } : {}),
    exitCode: params.exitCode ?? params.child?.exitCode,
    signal: params.signal ?? params.child?.signalCode,
    ...(stderr ? { stderr } : {}),
    ...(params.childError ? { childError: params.childError } : {}),
    replaySafe: params.replaySafe,
  });
}

async function invokeParentCallback(
  attempt: EmbeddedRunAttemptParams,
  callback: string,
  payload: unknown,
  state: ParentCallbackState,
): Promise<void> {
  switch (callback) {
    case "partial_reply":
      await attempt.onPartialReply?.((payload ?? {}) as { text?: string; mediaUrls?: string[] });
      return;
    case "assistant_message_start":
      await attempt.onAssistantMessageStart?.();
      return;
    case "block_reply":
      await attempt.onBlockReply?.(payload as BlockReplyPayload);
      return;
    case "block_reply_flush":
      await attempt.onBlockReplyFlush?.();
      return;
    case "reasoning_stream":
      await attempt.onReasoningStream?.((payload ?? {}) as { text?: string; mediaUrls?: string[] });
      return;
    case "reasoning_end":
      await attempt.onReasoningEnd?.();
      return;
    case "tool_result":
      await attempt.onToolResult?.(payload as ReplyPayload);
      return;
    case "agent_event": {
      if (!isRecord(payload) || typeof payload.stream !== "string" || !isRecord(payload.data)) {
        throw new PiIsolationProtocolError("PI isolation agent_event callback is malformed");
      }
      if (payload.stream === "compaction") {
        if (payload.data.phase === "start") {
          state.compacting = true;
        } else if (payload.data.phase === "end") {
          state.compacting = false;
        }
      }
      if (
        payload.stream === "lifecycle" &&
        (payload.data.phase === "end" || payload.data.phase === "error")
      ) {
        if (state.terminalLifecycleEvent) {
          throw new PiIsolationProtocolError(
            "PI isolation child emitted more than one terminal lifecycle event",
          );
        }
        state.terminalLifecycleEvent = {
          stream: payload.stream,
          data: { ...payload.data },
        };
        return;
      }
      emitAgentEvent({
        runId: attempt.runId,
        stream: payload.stream,
        data: payload.data,
      });
      await Promise.resolve(attempt.onAgentEvent?.({ stream: payload.stream, data: payload.data }));
      return;
    }
    default:
      throw new PiIsolationProtocolError(`Unknown PI isolation callback: ${callback}`);
  }
}

async function flushTerminalLifecycleEvent(
  attempt: EmbeddedRunAttemptParams,
  state: ParentCallbackState,
): Promise<void> {
  const event = state.terminalLifecycleEvent;
  if (!event) {
    return;
  }
  state.terminalLifecycleEvent = undefined;
  const data = { ...event.data };
  const meta = state.terminalLifecycleMeta;
  if (typeof meta?.replayInvalid === "boolean") {
    if (meta.replayInvalid) {
      data.replayInvalid = true;
    } else {
      delete data.replayInvalid;
    }
  }
  if (meta?.livenessState) {
    data.livenessState = meta.livenessState;
  }
  emitAgentEvent({ runId: attempt.runId, stream: event.stream, data });
  await Promise.resolve(attempt.onAgentEvent?.({ stream: event.stream, data }));
}

export async function runIsolatedPiAttempt(params: {
  attempt: EmbeddedRunAttemptParams;
  wireAttempt: Record<string, unknown>;
  toolHost: PiIsolationToolHost;
  hookRunner?: HookRunner | null;
  handshakeTimeoutMs?: number;
  startupTimeoutMs?: number;
  processTimeoutMs?: number;
}): Promise<EmbeddedRunAttemptResult> {
  const attempt = params.attempt;
  const hookRunner = params.hookRunner === undefined ? getGlobalHookRunner() : params.hookRunner;
  const activeHookNames = resolvePiIsolationBridgedHookNames(hookRunner);
  const activeHookNameSet = new Set(activeHookNames);
  let launch: ReturnType<typeof resolvePiIsolationChildLaunch>;
  try {
    launch = resolvePiIsolationChildLaunch();
  } catch (error) {
    throw new PiIsolatedProcessError("spawn", "Failed to resolve the PI isolation child launch", {
      cause: error,
      replaySafe: true,
    });
  }
  const runtimeApiKey = await attempt.authStorage.getApiKey(attempt.model.provider);
  const runtimeEnv = createPiIsolationRuntimeEnvironment();

  return await new Promise<EmbeddedRunAttemptResult>((resolve, reject) => {
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(launch.command, launch.args, {
        cwd: resolveUserPath(attempt.workspaceDir),
        env: createPiIsolationSpawnEnvironment({ tsconfigPath: launch.tsconfigPath }),
        stdio: ["pipe", "pipe", "pipe"],
        detached: process.platform !== "win32",
        windowsHide: true,
      });
    } catch (error) {
      reject(
        new PiIsolatedProcessError("spawn", "Failed to spawn the PI isolation child", {
          cause: error,
          replaySafe: true,
        }),
      );
      return;
    }

    const writer = new PiIsolationJsonlWriter(child.stdin);
    const sequence = new PiIsolationSequenceGuard();
    const state: ParentCallbackState & { streaming: boolean } = {
      streaming: false,
      compacting: false,
    };
    const pendingControls = new Map<string, PendingControl>();
    const runningToolCalls = new Map<string, RunningToolCall>();
    let nextControlId = 0;
    let stderr: Buffer = Buffer.alloc(0);
    let settled = false;
    let handshakeComplete = false;
    let readyReceived = false;
    let startSent = false;
    let promptBuildHookRequested = false;
    let agentEndHookNotified = false;
    let result: EmbeddedRunAttemptResult | undefined;
    let callbackTail: Promise<void> = Promise.resolve();
    let frameTail: Promise<void> = Promise.resolve();
    let queuedFrameBytes = 0;
    let activeRegistered = false;
    let abortRequested = attempt.abortSignal?.aborted === true;
    let childClosed = false;
    let failure: Error | undefined;
    let handshakeTimer: NodeJS.Timeout | undefined;
    let startupTimer: NodeJS.Timeout | undefined;
    let abortGraceTimer: NodeJS.Timeout | undefined;
    let forceKillTimer: NodeJS.Timeout | undefined;
    let processTimer: NodeJS.Timeout | undefined;

    const backend: EmbeddedPiQueueHandle & {
      kind: "embedded";
      cancel: (reason?: "user_abort" | "restart" | "superseded") => void;
    } = {
      kind: "embedded",
      queueMessage: async (text) => {
        if (!state.streaming || state.compacting) {
          throw new Error("PI isolation child is not accepting queued messages");
        }
        const commandId = `steer-${(nextControlId += 1)}`;
        await new Promise<void>((resolveControl, rejectControl) => {
          pendingControls.set(commandId, { resolve: resolveControl, reject: rejectControl });
          writer.send({ type: "steer", commandId, text }).catch((error) => {
            pendingControls.delete(commandId);
            rejectControl(error instanceof Error ? error : new Error(String(error)));
          });
        });
      },
      isStreaming: () => state.streaming,
      isCompacting: () => state.compacting,
      cancel: () => {
        requestAbort(new Error("PI isolation run cancelled"));
      },
      abort: () => {
        requestAbort(new Error("PI isolation run aborted"));
      },
    };

    const detachActiveRun = () => {
      if (!activeRegistered) {
        return;
      }
      activeRegistered = false;
      attempt.replyOperation?.detachBackend(backend);
      clearActiveEmbeddedRun(attempt.sessionId, backend, attempt.sessionKey);
    };

    const terminateProcessTree = () => {
      const childPid = child.pid;
      if (!childPid) {
        return;
      }
      killProcessTree(childPid, { graceMs: 2_000 });
      forceKillTimer ??= setTimeout(() => {
        forceKillTimer = undefined;
        if (child.exitCode !== null || child.signalCode !== null) {
          return;
        }
        try {
          if (process.platform !== "win32") {
            process.kill(-childPid, "SIGKILL");
          } else {
            child.kill("SIGKILL");
          }
        } catch {
          try {
            child.kill("SIGKILL");
          } catch {
            // The process exited between the liveness check and the signal.
          }
        }
      }, 2_100);
    };

    const cleanup = () => {
      if (handshakeTimer) {
        clearTimeout(handshakeTimer);
      }
      if (startupTimer) {
        clearTimeout(startupTimer);
      }
      if (processTimer) {
        clearTimeout(processTimer);
      }
      if (abortGraceTimer) {
        clearTimeout(abortGraceTimer);
      }
      attempt.abortSignal?.removeEventListener("abort", onExternalAbort);
      state.streaming = false;
      state.compacting = false;
      detachActiveRun();
      if (!params.toolHost.abortController.signal.aborted) {
        params.toolHost.abortController.abort(new Error("PI isolation run ended"));
      }
      for (const pending of pendingControls.values()) {
        pending.reject(new Error("PI isolation child exited"));
      }
      pendingControls.clear();
      for (const call of runningToolCalls.values()) {
        if (!call.controller.signal.aborted) {
          call.controller.abort(new Error("PI isolation child exited"));
        }
      }
      runningToolCalls.clear();
    };

    const refreshProcessError = (error: Error): Error => {
      if (!(error instanceof PiIsolatedProcessError)) {
        return error;
      }
      const refreshed = createProcessError({
        kind: error.kind,
        message: error.message,
        child,
        stderr,
        cause: error.cause,
        childError: error.childError,
        exitCode: error.exitCode,
        signal: error.signal,
        replaySafe: error.replaySafe,
      });
      refreshed.stack = error.stack;
      return refreshed;
    };

    const finalizeFailure = () => {
      if (settled || !failure || !childClosed) {
        return;
      }
      settled = true;
      reject(refreshProcessError(failure));
    };

    const settleError = (error: Error, terminate = true) => {
      if (settled || failure) {
        return;
      }
      failure =
        error instanceof PiIsolatedProcessError
          ? error
          : createProcessError({
              kind: "protocol",
              message: error.message,
              child,
              stderr,
              cause: error,
              replaySafe: !readyReceived,
            });
      cleanup();
      if (terminate) {
        terminateProcessTree();
      }
      finalizeFailure();
    };

    const settleResult = (value: EmbeddedRunAttemptResult) => {
      if (settled || failure || !childClosed) {
        return;
      }
      settled = true;
      cleanup();
      resolve({
        ...value,
        piIsolation: {
          mode: "isolated",
          protocolVersion: PI_ISOLATION_PROTOCOL_VERSION,
          childPid: child.pid,
        },
      });
    };

    const scheduleProcessDeadline = (delayMs: number) => {
      if (processTimer) {
        clearTimeout(processTimer);
      }
      processTimer = setTimeout(() => {
        settleError(
          createProcessError({
            kind: "timeout",
            message: "PI isolation child exceeded its process deadline",
            child,
            stderr,
            replaySafe: false,
          }),
        );
      }, delayMs);
      processTimer.unref?.();
    };

    const scheduleStartupDeadline = () => {
      startupTimer = setTimeout(() => {
        settleError(
          createProcessError({
            kind: "startup",
            message: "PI isolation child startup timed out before the session became ready",
            child,
            stderr,
            replaySafe: true,
          }),
        );
      }, params.startupTimeoutMs ?? STARTUP_TIMEOUT_MS);
      startupTimer.unref?.();
    };

    const extendDeadlineForCompaction = () => {
      if (params.processTimeoutMs !== undefined) {
        return;
      }
      scheduleProcessDeadline(
        resolveCompactionTimeoutMs(attempt.config) + PROCESS_TIMEOUT_OVERHEAD_MS,
      );
    };

    function requestAbort(reason: unknown): void {
      abortRequested = true;
      if (!params.toolHost.abortController.signal.aborted) {
        params.toolHost.abortController.abort(reason);
      }
      if (startSent && child.stdin.writable) {
        void writer.send({ type: "abort", reason: serializePiIsolationError(reason) }).catch(() => {
          terminateProcessTree();
        });
      }
      if (!abortGraceTimer) {
        abortGraceTimer = setTimeout(() => {
          settleError(
            createProcessError({
              kind: "aborted",
              message: "PI isolation child did not exit after abort",
              child,
              stderr,
              cause: reason,
              replaySafe: false,
            }),
          );
        }, ABORT_GRACE_MS);
        abortGraceTimer.unref?.();
      }
    }

    function onExternalAbort(): void {
      requestAbort(attempt.abortSignal?.reason ?? new Error("PI isolation run aborted"));
    }

    const startToolCall = (frame: Record<string, unknown>) => {
      const bridgeCallId = requireString(frame, "bridgeCallId");
      if (runningToolCalls.has(bridgeCallId)) {
        throw new PiIsolationProtocolError(
          `PI isolation child reused tool call id ${bridgeCallId}`,
        );
      }
      const toolName = requireString(frame, "toolName");
      if (toolName === "sessions_yield") {
        throw new PiIsolationProtocolError(
          "PI isolation child attempted to proxy child-local sessions_yield",
        );
      }
      const controller = new AbortController();
      const runningCall: RunningToolCall = {
        controller,
        updateTail: Promise.resolve(),
      };
      runningToolCalls.set(bridgeCallId, runningCall);
      const toolCallId = requireString(frame, "toolCallId");
      void params.toolHost
        .execute({
          toolName,
          toolCallId,
          toolParams: frame.params,
          signal: controller.signal,
          onUpdate: (update) => {
            runningCall.updateTail = runningCall.updateTail.then(() =>
              writer.send({ type: "tool_update", bridgeCallId, update }),
            );
            runningCall.updateTail.catch((error) => {
              settleError(error instanceof Error ? error : new Error(String(error)));
            });
          },
        })
        .then(
          async (toolResult) => {
            await runningCall.updateTail;
            await writer.send({ type: "tool_result", bridgeCallId, result: toolResult });
          },
          async (error) => {
            await runningCall.updateTail;
            await writer.send({
              type: "tool_error",
              bridgeCallId,
              error: serializePiIsolationError(error),
            });
          },
        )
        .catch((error) => {
          settleError(error instanceof Error ? error : new Error(String(error)));
        })
        .finally(() => {
          runningToolCalls.delete(bridgeCallId);
        });
    };

    const handleCallback = (frame: Record<string, unknown>) => {
      const callback = requireString(frame, "callback");
      const callbackId = typeof frame.callbackId === "string" ? frame.callbackId : undefined;
      callbackTail = callbackTail.then(async () => {
        try {
          const wasCompacting = state.compacting;
          await invokeParentCallback(attempt, callback, frame.payload, state);
          if (!wasCompacting && state.compacting) {
            extendDeadlineForCompaction();
          }
          if (callbackId) {
            await writer.send({ type: "callback_result", callbackId });
          }
        } catch (error) {
          if (callbackId) {
            await writer.send({
              type: "callback_result",
              callbackId,
              error: serializePiIsolationError(error),
            });
            return;
          }
          throw error;
        }
      });
      callbackTail.catch((error) => {
        settleError(error instanceof Error ? error : new Error(String(error)));
      });
    };

    const handleFrame = async (value: unknown): Promise<void> => {
      assertPiIsolationFrame(value);
      const frame = value as Record<string, unknown>;
      if (!handshakeComplete) {
        if (frame.type !== "hello" || frame.seq !== 0) {
          throw new PiIsolationProtocolError("PI isolation child did not send hello first");
        }
        const hello = frame as unknown as PiIsolationHelloFrame;
        if (
          hello.role !== "child" ||
          !Number.isSafeInteger(hello.pid) ||
          hello.pid <= 0 ||
          hello.pid !== child.pid
        ) {
          throw new PiIsolationProtocolError("PI isolation child sent an invalid hello");
        }
        handshakeComplete = true;
        if (handshakeTimer) {
          clearTimeout(handshakeTimer);
          handshakeTimer = undefined;
        }
        startSent = true;
        scheduleStartupDeadline();
        await writer.send({
          type: "start",
          attempt: params.wireAttempt,
          trace: params.toolHost.trace,
          ...(runtimeApiKey ? { runtimeApiKey } : {}),
          ...(Object.keys(runtimeEnv).length > 0 ? { runtimeEnv } : {}),
          ...(attempt.runtimePlan?.resolvedRef.transport
            ? { resolvedTransport: attempt.runtimePlan.resolvedRef.transport }
            : {}),
          tools: params.toolHost.descriptors,
          hookNames: activeHookNames,
          ...(attempt.shouldEmitToolResult
            ? { shouldEmitToolResult: attempt.shouldEmitToolResult() }
            : {}),
          ...(attempt.shouldEmitToolOutput
            ? { shouldEmitToolOutput: attempt.shouldEmitToolOutput() }
            : {}),
        });
        if (abortRequested) {
          await writer.send({
            type: "abort",
            reason: serializePiIsolationError(
              attempt.abortSignal?.reason ?? new Error("PI isolation run aborted"),
            ),
          });
        }
        return;
      }

      if (sequence.accept(frame.seq as number) === "duplicate") {
        return;
      }
      const typedFrame = frame as unknown as PiIsolationChildFrame;
      if (!readyReceived && typedFrame.type !== "ready" && typedFrame.type !== "fatal") {
        throw new PiIsolationProtocolError(
          `PI isolation child sent ${typedFrame.type} before ready`,
        );
      }
      switch (typedFrame.type) {
        case "ready":
          if (
            readyReceived ||
            !Number.isSafeInteger(typedFrame.pid) ||
            typedFrame.pid !== child.pid
          ) {
            throw new PiIsolationProtocolError("PI isolation child sent an invalid ready frame");
          }
          readyReceived = true;
          if (startupTimer) {
            clearTimeout(startupTimer);
            startupTimer = undefined;
          }
          scheduleProcessDeadline(
            params.processTimeoutMs ?? Math.max(1, attempt.timeoutMs) + PROCESS_TIMEOUT_OVERHEAD_MS,
          );
          return;
        case "state":
          if (
            typeof typedFrame.streaming !== "boolean" ||
            typeof typedFrame.compacting !== "boolean"
          ) {
            throw new PiIsolationProtocolError("PI isolation child sent an invalid state frame");
          }
          if (!state.compacting && typedFrame.compacting) {
            extendDeadlineForCompaction();
          }
          state.streaming = typedFrame.streaming;
          state.compacting = typedFrame.compacting;
          if (state.streaming && !activeRegistered) {
            activeRegistered = true;
            setActiveEmbeddedRun(attempt.sessionId, backend, attempt.sessionKey);
            attempt.replyOperation?.attachBackend(backend);
          } else if (!state.streaming) {
            detachActiveRun();
          }
          return;
        case "callback":
          handleCallback(frame);
          return;
        case "tool_call":
          startToolCall(frame);
          return;
        case "tool_abort": {
          const bridgeCallId = requireString(frame, "bridgeCallId");
          const call = runningToolCalls.get(bridgeCallId);
          if (call && !call.controller.signal.aborted) {
            call.controller.abort(new Error("PI child aborted the tool call"));
          }
          return;
        }
        case "hook_request": {
          const requestId = requireString(frame, "requestId");
          if (
            typedFrame.hookName !== "before_prompt_build" ||
            !activeHookNameSet.has("before_prompt_build") ||
            !hookRunner
          ) {
            throw new PiIsolationProtocolError(
              "PI isolation child requested an inactive before_prompt_build hook",
            );
          }
          if (promptBuildHookRequested) {
            throw new PiIsolationProtocolError(
              "PI isolation child requested before_prompt_build more than once",
            );
          }
          if (
            !isRecord(typedFrame.event) ||
            typeof typedFrame.event.prompt !== "string" ||
            !Array.isArray(typedFrame.event.messages) ||
            !isRecord(typedFrame.context)
          ) {
            throw new PiIsolationProtocolError(
              "PI isolation before_prompt_build request is malformed",
            );
          }
          promptBuildHookRequested = true;
          try {
            const hookResult = await hookRunner.runBeforePromptBuild(
              typedFrame.event,
              typedFrame.context,
            );
            await writer.send({
              type: "hook_result",
              requestId,
              hookName: "before_prompt_build",
              ...(hookResult ? { result: hookResult } : {}),
            });
          } catch (error) {
            await writer.send({
              type: "hook_result",
              requestId,
              hookName: "before_prompt_build",
              error: serializePiIsolationError(error),
            });
          }
          return;
        }
        case "hook_notification": {
          if (
            typedFrame.hookName !== "agent_end" ||
            !activeHookNameSet.has("agent_end") ||
            !hookRunner
          ) {
            throw new PiIsolationProtocolError(
              "PI isolation child notified an inactive agent_end hook",
            );
          }
          if (agentEndHookNotified) {
            throw new PiIsolationProtocolError(
              "PI isolation child notified agent_end more than once",
            );
          }
          if (
            !isRecord(typedFrame.event) ||
            !Array.isArray(typedFrame.event.messages) ||
            (typedFrame.event.newMessages !== undefined &&
              !Array.isArray(typedFrame.event.newMessages)) ||
            typeof typedFrame.event.success !== "boolean" ||
            (typedFrame.event.error !== undefined && typeof typedFrame.event.error !== "string") ||
            (typedFrame.event.durationMs !== undefined &&
              (typeof typedFrame.event.durationMs !== "number" ||
                !Number.isFinite(typedFrame.event.durationMs))) ||
            !isRecord(typedFrame.context)
          ) {
            throw new PiIsolationProtocolError("PI isolation agent_end notification is malformed");
          }
          agentEndHookNotified = true;
          void hookRunner.runAgentEnd(typedFrame.event, typedFrame.context).catch((error) => {
            log.warn(`agent_end hook failed across PI isolation: ${String(error)}`);
          });
          return;
        }
        case "control_result": {
          const commandId = requireString(frame, "commandId");
          if (typeof typedFrame.accepted !== "boolean") {
            throw new PiIsolationProtocolError("PI isolation child sent an invalid control result");
          }
          const pending = pendingControls.get(commandId);
          if (!pending) {
            return;
          }
          pendingControls.delete(commandId);
          if (typedFrame.accepted) {
            pending.resolve();
          } else {
            pending.reject(
              typedFrame.error
                ? deserializePiIsolationError(typedFrame.error)
                : new Error("PI isolation child rejected the control request"),
            );
          }
          return;
        }
        case "result":
          if (!isRecord(typedFrame.result)) {
            throw new PiIsolationProtocolError("PI isolation result frame is malformed");
          }
          result = deserializePiIsolationAttemptResult(typedFrame.result);
          result.setTerminalLifecycleMeta = (meta) => {
            state.terminalLifecycleMeta = {
              ...state.terminalLifecycleMeta,
              ...meta,
            };
          };
          result.flushTerminalLifecycleEvent = () => flushTerminalLifecycleEvent(attempt, state);
          state.streaming = false;
          state.compacting = false;
          return;
        case "fatal": {
          if (!(["handshake", "setup", "run", "protocol"] as const).includes(typedFrame.phase)) {
            throw new PiIsolationProtocolError("PI isolation child sent an invalid fatal phase");
          }
          const childError = requireWireError(typedFrame.error);
          throw createProcessError({
            kind:
              abortRequested && typedFrame.phase !== "handshake"
                ? "aborted"
                : typedFrame.phase === "handshake"
                  ? "handshake"
                  : typedFrame.phase === "setup"
                    ? "startup"
                    : "exit",
            message: `PI isolation child failed during ${typedFrame.phase}: ${childError.message}`,
            child,
            stderr,
            cause: deserializePiIsolationError(childError),
            childError,
            replaySafe: !readyReceived && !abortRequested,
          });
        }
        default:
          throw new PiIsolationProtocolError(
            `Unknown PI isolation child frame: ${String(frame.type)}`,
          );
      }
    };

    const decoder = createPiIsolationJsonlDecoder({
      onFrame: (frame, frameBytes) => {
        queuedFrameBytes += frameBytes;
        if (queuedFrameBytes > PI_ISOLATION_MAX_QUEUED_BYTES) {
          settleError(
            createProcessError({
              kind: "protocol",
              message: "PI isolation input queue exceeded its limit",
              child,
              stderr,
              replaySafe: !readyReceived,
            }),
          );
          return;
        }
        frameTail = frameTail
          .then(() => handleFrame(frame))
          .catch((error) => {
            settleError(
              error instanceof PiIsolatedProcessError
                ? error
                : createProcessError({
                    kind: "protocol",
                    message: error instanceof Error ? error.message : String(error),
                    child,
                    stderr,
                    cause: error,
                    replaySafe: !readyReceived,
                  }),
            );
          })
          .finally(() => {
            queuedFrameBytes -= frameBytes;
          });
      },
      onError: (error) => {
        settleError(
          createProcessError({
            kind: "protocol",
            message: error.message,
            child,
            stderr,
            cause: error,
            replaySafe: !readyReceived,
          }),
        );
      },
    });

    child.stdout.on("data", (chunk: Buffer) => decoder.push(chunk));
    child.stdout.on("end", () => decoder.end());
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = appendCapturedStderr(stderr, chunk);
    });
    child.once("error", (error) => {
      settleError(
        createProcessError({
          kind: "spawn",
          message: `PI isolation child process error: ${error.message}`,
          child,
          stderr,
          cause: error,
          replaySafe: !readyReceived,
        }),
      );
    });
    child.once("close", (exitCode, signal) => {
      childClosed = true;
      if (forceKillTimer) {
        clearTimeout(forceKillTimer);
        forceKillTimer = undefined;
      }
      void frameTail
        .catch(() => undefined)
        .then(() => callbackTail.catch(() => undefined))
        .then(() => {
          if (failure) {
            finalizeFailure();
            return;
          }
          if (settled) {
            return;
          }
          if (exitCode !== 0 || signal) {
            settleError(
              createProcessError({
                kind: abortRequested ? "aborted" : "exit",
                message: `PI isolation child exited unexpectedly (code=${String(exitCode)}, signal=${String(signal)})`,
                child,
                stderr,
                exitCode,
                signal,
                replaySafe: !readyReceived && !abortRequested,
              }),
              false,
            );
            return;
          }
          if (!result) {
            settleError(
              createProcessError({
                kind: "protocol",
                message: "PI isolation child exited without a result",
                child,
                stderr,
                exitCode,
                signal,
                replaySafe: !readyReceived && !abortRequested,
              }),
              false,
            );
            return;
          }
          settleResult(result);
        });
    });

    handshakeTimer = setTimeout(() => {
      settleError(
        createProcessError({
          kind: "handshake",
          message: "PI isolation child handshake timed out",
          child,
          stderr,
          replaySafe: true,
        }),
      );
    }, params.handshakeTimeoutMs ?? HANDSHAKE_TIMEOUT_MS);
    handshakeTimer.unref?.();

    if (attempt.abortSignal) {
      if (attempt.abortSignal.aborted) {
        onExternalAbort();
      } else {
        attempt.abortSignal.addEventListener("abort", onExternalAbort, { once: true });
      }
    }
  });
}
