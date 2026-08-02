import { Console } from "node:console";
import path from "node:path";
import type { Model } from "@earendil-works/pi-ai";
import {
  isValidDiagnosticSpanId,
  isValidDiagnosticTraceFlags,
  isValidDiagnosticTraceId,
} from "../../../infra/diagnostic-trace-context.js";
import type { AgentRuntimeTransport } from "../../runtime-plan/types.js";
import type { EmbeddedRunAttemptParams } from "../run/types.js";
import { createPiIsolationHookProxyBridge } from "./hook-proxy.js";
import {
  assertPiIsolationFrame,
  createPiIsolationHelloFrame,
  createPiIsolationJsonlDecoder,
  deserializePiIsolationError,
  parsePiIsolationBridgedHookNames,
  PI_ISOLATION_MAX_QUEUED_BYTES,
  PiIsolationJsonlWriter,
  PiIsolationProtocolError,
  PiIsolationSequenceGuard,
  serializePiIsolationAttemptResult,
  serializePiIsolationError,
  type PiIsolationParentFrame,
} from "./protocol.js";
import { activatePiIsolationProviderRuntime } from "./provider-activation.js";
import { createPiIsolationToolProxyBridge } from "./tool-proxy.js";

const PARENT_START_TIMEOUT_MS = 15_000;
const SHUTDOWN_GRACE_MS = 10_000;

type PendingCallback = {
  resolve: () => void;
  reject: (error: Error) => void;
};

const RUNTIME_TRANSPORTS = new Set<AgentRuntimeTransport>([
  "sse",
  "websocket",
  "websocket-cached",
  "auto",
]);

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

function isValidTrace(value: unknown): boolean {
  if (!isRecord(value) || !isValidDiagnosticTraceId(value.traceId)) {
    return false;
  }
  return (
    (value.spanId === undefined || isValidDiagnosticSpanId(value.spanId)) &&
    (value.parentSpanId === undefined || isValidDiagnosticSpanId(value.parentSpanId)) &&
    (value.traceFlags === undefined || isValidDiagnosticTraceFlags(value.traceFlags))
  );
}

function applyRuntimeEnvironment(value: unknown): void {
  if (value === undefined) {
    return;
  }
  if (!isRecord(value)) {
    throw new PiIsolationProtocolError("PI isolation start frame has an invalid runtime env");
  }
  for (const [key, envValue] of Object.entries(value)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(key) || typeof envValue !== "string") {
      throw new PiIsolationProtocolError("PI isolation start frame has an invalid runtime env");
    }
    process.env[key] = envValue;
  }
}

function parseBeforePromptBuildResult(value: unknown) {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    throw new PiIsolationProtocolError("PI isolation hook result is malformed");
  }
  for (const key of [
    "systemPrompt",
    "prependContext",
    "prependSystemContext",
    "appendSystemContext",
  ] as const) {
    if (value[key] !== undefined && typeof value[key] !== "string") {
      throw new PiIsolationProtocolError("PI isolation hook result is malformed");
    }
  }
  return value;
}

function redirectConsoleOutputToStderr(): void {
  globalThis.console = new Console({
    stdout: process.stderr,
    stderr: process.stderr,
    colorMode: false,
  });
}

function writeHello(): Promise<void> {
  const encoded = `${JSON.stringify(createPiIsolationHelloFrame(process.pid))}\n`;
  return new Promise((resolve, reject) => {
    process.stdout.write(encoded, (error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

async function main(): Promise<void> {
  redirectConsoleOutputToStderr();
  await writeHello();
  const writer = new PiIsolationJsonlWriter(process.stdout);
  const sequence = new PiIsolationSequenceGuard();
  const pendingCallbacks = new Map<string, PendingCallback>();
  const pendingNotifications = new Set<Promise<void>>();
  const toolProxyBridge = createPiIsolationToolProxyBridge({
    send: (frame) => writer.send(frame),
  });
  const runAbortController = new AbortController();
  let hookProxyBridge: ReturnType<typeof createPiIsolationHookProxyBridge> | undefined;
  let nextCallbackId = 0;
  let frameTail: Promise<void> = Promise.resolve();
  let queuedFrameBytes = 0;
  let started = false;
  let finished = false;
  let activeSessionId: string | undefined;
  let readySent = false;
  let notificationError: unknown;
  let forceExitTimer: NodeJS.Timeout | undefined;

  const rejectPending = (error: Error) => {
    for (const pending of pendingCallbacks.values()) {
      pending.reject(error);
    }
    pendingCallbacks.clear();
    hookProxyBridge?.rejectAll(error);
    toolProxyBridge.rejectAll(error);
  };

  const close = async (exitCode: number) => {
    if (finished) {
      return;
    }
    finished = true;
    clearTimeout(startTimer);
    if (forceExitTimer) {
      clearTimeout(forceExitTimer);
    }
    rejectPending(new Error("PI isolation child is shutting down"));
    await writer.flush().catch(() => undefined);
    process.stdin.destroy();
    process.stdout.end(() => process.exit(exitCode));
  };

  const sendFatal = async (phase: "handshake" | "setup" | "run" | "protocol", error: unknown) => {
    if (finished) {
      return;
    }
    await writer
      .send({ type: "fatal", phase, error: serializePiIsolationError(error) })
      .catch(() => undefined);
    await close(1);
  };

  const abortRun = async (reason: unknown) => {
    if (!runAbortController.signal.aborted) {
      runAbortController.abort(reason);
    }
    if (activeSessionId) {
      const { abortEmbeddedPiRun } = await import("../runs.js");
      abortEmbeddedPiRun(activeSessionId);
    }
  };

  const requestParentCallback = async (callback: string, payload?: unknown): Promise<void> => {
    const callbackId = `callback-${(nextCallbackId += 1)}`;
    await new Promise<void>((resolve, reject) => {
      pendingCallbacks.set(callbackId, { resolve, reject });
      writer.send({ type: "callback", callbackId, callback, payload }).catch((error) => {
        pendingCallbacks.delete(callbackId);
        reject(error instanceof Error ? error : new Error(String(error)));
      });
    });
  };

  const notifyParent = (callback: string, payload?: unknown): void => {
    const task = requestParentCallback(callback, payload)
      .catch(async (error) => {
        notificationError ??= error;
        await abortRun(error);
      })
      .finally(() => {
        pendingNotifications.delete(task);
      });
    pendingNotifications.add(task);
  };

  const startRun = async (frame: Extract<PiIsolationParentFrame, { type: "start" }>) => {
    if (started) {
      throw new PiIsolationProtocolError("PI isolation child received more than one start frame");
    }
    started = true;
    clearTimeout(startTimer);
    if (!isRecord(frame.attempt) || !Array.isArray(frame.tools) || !isValidTrace(frame.trace)) {
      throw new PiIsolationProtocolError("PI isolation start frame is malformed");
    }
    applyRuntimeEnvironment(frame.runtimeEnv);
    if (
      frame.resolvedTransport !== undefined &&
      !RUNTIME_TRANSPORTS.has(frame.resolvedTransport as AgentRuntimeTransport)
    ) {
      throw new PiIsolationProtocolError("PI isolation start frame has an invalid transport");
    }
    const rawModel = frame.attempt.model;
    if (
      !isRecord(rawModel) ||
      typeof rawModel.provider !== "string" ||
      !rawModel.provider ||
      typeof rawModel.id !== "string" ||
      !rawModel.id
    ) {
      throw new PiIsolationProtocolError("PI isolation start frame has an invalid model");
    }
    const rawConfig = frame.attempt.config;
    if (rawConfig !== undefined && !isRecord(rawConfig)) {
      throw new PiIsolationProtocolError("PI isolation start frame has an invalid config");
    }
    const attemptProvider = frame.attempt.provider;
    if (typeof attemptProvider !== "string" || !attemptProvider) {
      throw new PiIsolationProtocolError("PI isolation start frame has an invalid provider");
    }
    const workspaceDir = frame.attempt.workspaceDir;
    if (typeof workspaceDir !== "string" || !workspaceDir) {
      throw new PiIsolationProtocolError("PI isolation start frame has an invalid workspace");
    }
    const sessionId = frame.attempt.sessionId;
    if (typeof sessionId !== "string") {
      throw new PiIsolationProtocolError("PI isolation start frame is missing its session id");
    }
    activeSessionId = sessionId;
    const activeHookNames = parsePiIsolationBridgedHookNames(frame.hookNames);
    hookProxyBridge = createPiIsolationHookProxyBridge({
      activeHookNames,
      send: (hookFrame) => writer.send(hookFrame),
    });

    try {
      const [
        agentPaths,
        modelDiscovery,
        contextModule,
        toolsModule,
        runtimePlanModule,
        attemptModule,
        providersRuntime,
      ] = await Promise.all([
        import("../../agent-paths.js"),
        import("../../pi-model-discovery.js"),
        import("../../../context-engine/legacy.js"),
        import("../../../plugins/tools.js"),
        import("../../runtime-plan/build.js"),
        import("../run/attempt.js"),
        import("../../../plugins/providers.runtime.js"),
      ]);
      activatePiIsolationProviderRuntime({
        attemptProvider,
        modelProvider: rawModel.provider,
        config: rawConfig as EmbeddedRunAttemptParams["config"],
        workspaceDir,
        env: process.env,
        resolvePluginProviders: providersRuntime.resolvePluginProviders,
      });
      const agentDir =
        typeof frame.attempt.agentDir === "string"
          ? frame.attempt.agentDir
          : agentPaths.resolveGenesisAgentDir();
      const authStorage = modelDiscovery.createRuntimeCredentialStore({});
      if (frame.runtimeApiKey) {
        authStorage.setRuntimeApiKey(rawModel.provider, frame.runtimeApiKey);
        if (attemptProvider !== rawModel.provider) {
          authStorage.setRuntimeApiKey(attemptProvider, frame.runtimeApiKey);
        }
      }
      const modelRuntime = await modelDiscovery.createPiModelRuntime(
        authStorage,
        path.join(agentDir, "models.json"),
      );
      const modelRegistry = new modelDiscovery.ModelRegistry(modelRuntime);
      const model = rawModel as unknown as Model<string>;
      const authProfileId =
        typeof frame.attempt.authProfileId === "string" ? frame.attempt.authProfileId : undefined;
      const harnessId =
        typeof frame.attempt.agentHarnessId === "string" ? frame.attempt.agentHarnessId : "pi";
      const streamParams = isRecord(frame.attempt.streamParams) ? frame.attempt.streamParams : {};
      const runtimePlan = runtimePlanModule.buildAgentRuntimePlan({
        provider: rawModel.provider,
        modelId: rawModel.id,
        model,
        modelApi: model.api,
        harnessId,
        harnessRuntime: harnessId,
        allowHarnessAuthProfileForwarding: false,
        authProfileProvider: authProfileId?.split(":", 1)[0],
        sessionAuthProfileId: authProfileId,
        config: rawConfig as EmbeddedRunAttemptParams["config"],
        workspaceDir,
        agentDir,
        agentId: typeof frame.attempt.agentId === "string" ? frame.attempt.agentId : undefined,
        thinkingLevel: frame.attempt.thinkLevel as Parameters<
          typeof runtimePlanModule.buildAgentRuntimePlan
        >[0]["thinkingLevel"],
        extraParamsOverride: {
          ...streamParams,
          ...(typeof frame.attempt.fastMode === "boolean"
            ? { fastMode: frame.attempt.fastMode }
            : {}),
        },
        resolvedTransport: frame.resolvedTransport as AgentRuntimeTransport | undefined,
      });
      const proxyTools = frame.tools.map((descriptor) => {
        const tool = toolProxyBridge.createTool(descriptor);
        if (descriptor.pluginMeta) {
          toolsModule.setPluginToolMeta(tool, descriptor.pluginMeta);
        }
        return tool;
      });
      const localToolNames = frame.tools.some((descriptor) => descriptor.name === "sessions_yield")
        ? (["sessions_yield"] as const)
        : [];
      const attempt = {
        ...frame.attempt,
        agentDir,
        model,
        authStorage,
        modelRegistry,
        contextEngine: new contextModule.LegacyContextEngine(),
        runtimePlan,
        abortSignal: runAbortController.signal,
        isolatedToolBridge: {
          tools: proxyTools,
          localToolNames,
          trace: frame.trace,
          onReady: async () => {
            if (readySent) {
              throw new PiIsolationProtocolError(
                "PI isolation session became ready more than once",
              );
            }
            readySent = true;
            await writer.send({ type: "ready", pid: process.pid });
            await writer.send({ type: "state", streaming: true, compacting: false });
          },
        },
        isolatedHookRunner: hookProxyBridge.hookRunner,
        shouldEmitToolResult:
          typeof frame.shouldEmitToolResult === "boolean"
            ? () => frame.shouldEmitToolResult as boolean
            : undefined,
        shouldEmitToolOutput:
          typeof frame.shouldEmitToolOutput === "boolean"
            ? () => frame.shouldEmitToolOutput as boolean
            : undefined,
        onPartialReply: (payload: unknown) => requestParentCallback("partial_reply", payload),
        onAssistantMessageStart: () => requestParentCallback("assistant_message_start"),
        onBlockReply: (payload: unknown) => requestParentCallback("block_reply", payload),
        onBlockReplyFlush: () => requestParentCallback("block_reply_flush"),
        onReasoningStream: (payload: unknown) => requestParentCallback("reasoning_stream", payload),
        onReasoningEnd: () => requestParentCallback("reasoning_end"),
        onToolResult: (payload: unknown) => requestParentCallback("tool_result", payload),
        onAgentEvent: (payload: unknown) => notifyParent("agent_event", payload),
      } as unknown as EmbeddedRunAttemptParams;

      if (runAbortController.signal.aborted) {
        await abortRun(runAbortController.signal.reason);
      }
      const result = await attemptModule.runEmbeddedAttempt(attempt);
      await Promise.all(pendingNotifications);
      if (notificationError) {
        throw notificationError;
      }
      if (!readySent) {
        throw new PiIsolationProtocolError("PI isolation attempt ended before becoming ready");
      }
      await writer.send({ type: "state", streaming: false, compacting: false });
      await writer.send({ type: "result", result: serializePiIsolationAttemptResult(result) });
      await close(0);
    } catch (error) {
      await sendFatal(readySent ? "run" : "setup", error);
    }
  };

  const handleFrame = async (value: unknown): Promise<void> => {
    assertPiIsolationFrame(value);
    const frame = value as unknown as PiIsolationParentFrame;
    if (sequence.accept(frame.seq) === "duplicate") {
      return;
    }
    if (!started && frame.type !== "start") {
      throw new PiIsolationProtocolError(`PI isolation parent sent ${frame.type} before start`);
    }
    switch (frame.type) {
      case "start":
        void startRun(frame).catch((error) => sendFatal("setup", error));
        return;
      case "abort":
        await abortRun(
          frame.reason
            ? deserializePiIsolationError(frame.reason)
            : new Error("Parent aborted PI isolation run"),
        );
        return;
      case "steer": {
        const commandId = requireString(frame as unknown as Record<string, unknown>, "commandId");
        const text = requireString(frame as unknown as Record<string, unknown>, "text");
        const { queueEmbeddedPiMessage } = await import("../runs.js");
        const accepted = activeSessionId ? queueEmbeddedPiMessage(activeSessionId, text) : false;
        await writer.send({
          type: "control_result",
          commandId,
          accepted,
          ...(!accepted
            ? {
                error: serializePiIsolationError(new Error("PI session is not accepting steering")),
              }
            : {}),
        });
        return;
      }
      case "callback_result": {
        const callbackId = requireString(frame as unknown as Record<string, unknown>, "callbackId");
        const pending = pendingCallbacks.get(callbackId);
        if (!pending) {
          return;
        }
        pendingCallbacks.delete(callbackId);
        if (frame.error) {
          pending.reject(deserializePiIsolationError(frame.error));
        } else {
          pending.resolve();
        }
        return;
      }
      case "tool_update": {
        const bridgeCallId = requireString(
          frame as unknown as Record<string, unknown>,
          "bridgeCallId",
        );
        toolProxyBridge.update(bridgeCallId, frame.update);
        return;
      }
      case "tool_result": {
        const bridgeCallId = requireString(
          frame as unknown as Record<string, unknown>,
          "bridgeCallId",
        );
        toolProxyBridge.resolve(bridgeCallId, frame.result);
        return;
      }
      case "tool_error": {
        const bridgeCallId = requireString(
          frame as unknown as Record<string, unknown>,
          "bridgeCallId",
        );
        if (
          !isRecord(frame.error) ||
          typeof frame.error.name !== "string" ||
          typeof frame.error.message !== "string"
        ) {
          throw new PiIsolationProtocolError("PI isolation tool error frame is malformed");
        }
        toolProxyBridge.reject(bridgeCallId, deserializePiIsolationError(frame.error));
        return;
      }
      case "hook_result": {
        const requestId = requireString(frame as unknown as Record<string, unknown>, "requestId");
        if (frame.hookName !== "before_prompt_build") {
          throw new PiIsolationProtocolError("PI isolation hook result has an invalid hook name");
        }
        if (!hookProxyBridge) {
          throw new PiIsolationProtocolError("PI isolation hook result arrived before start");
        }
        if (frame.error) {
          if (
            !isRecord(frame.error) ||
            typeof frame.error.name !== "string" ||
            typeof frame.error.message !== "string"
          ) {
            throw new PiIsolationProtocolError("PI isolation hook error frame is malformed");
          }
          if (!hookProxyBridge.reject(requestId, deserializePiIsolationError(frame.error))) {
            throw new PiIsolationProtocolError(
              `PI isolation hook result has an unknown request id: ${requestId}`,
            );
          }
        } else {
          if (!hookProxyBridge.resolve(requestId, parseBeforePromptBuildResult(frame.result))) {
            throw new PiIsolationProtocolError(
              `PI isolation hook result has an unknown request id: ${requestId}`,
            );
          }
        }
        return;
      }
      default:
        throw new PiIsolationProtocolError(
          `Unknown PI isolation parent frame: ${String((frame as { type?: unknown }).type)}`,
        );
    }
  };

  const decoder = createPiIsolationJsonlDecoder({
    onFrame: (frame, frameBytes) => {
      queuedFrameBytes += frameBytes;
      if (queuedFrameBytes > PI_ISOLATION_MAX_QUEUED_BYTES) {
        void sendFatal(
          "protocol",
          new PiIsolationProtocolError("PI isolation input queue exceeded its limit"),
        );
        return;
      }
      frameTail = frameTail
        .then(() => handleFrame(frame))
        .catch((error) => sendFatal("protocol", error))
        .finally(() => {
          queuedFrameBytes -= frameBytes;
        });
    },
    onError: (error) => {
      void sendFatal("protocol", error);
    },
  });
  process.stdin.on("data", (chunk: Buffer) => decoder.push(chunk));
  process.stdin.on("end", () => {
    decoder.end();
    if (!finished) {
      void abortRun(new Error("PI isolation parent disconnected"));
      forceExitTimer = setTimeout(() => void close(1), SHUTDOWN_GRACE_MS);
      forceExitTimer.unref?.();
    }
  });
  process.stdin.on("error", (error) => {
    void sendFatal("protocol", error);
  });

  const onSignal = (signal: NodeJS.Signals) => {
    void abortRun(new Error(`PI isolation child received ${signal}`));
    if (!forceExitTimer) {
      forceExitTimer = setTimeout(() => void close(1), SHUTDOWN_GRACE_MS);
      forceExitTimer.unref?.();
    }
  };
  process.once("SIGTERM", () => onSignal("SIGTERM"));
  process.once("SIGINT", () => onSignal("SIGINT"));
  if (process.platform !== "win32") {
    process.once("SIGHUP", () => onSignal("SIGHUP"));
  }

  const startTimer = setTimeout(() => {
    void sendFatal("handshake", new Error("PI isolation parent did not send start"));
  }, PARENT_START_TIMEOUT_MS);
  startTimer.unref?.();
}

void main().catch((error) => {
  process.stderr.write(`PI isolation child bootstrap failed: ${String(error)}\n`);
  process.exit(1);
});
