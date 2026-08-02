import type { Writable } from "node:stream";
import type { DiagnosticTraceContext } from "../../../infra/diagnostic-trace-context.js";
import type {
  PluginHookAgentContext,
  PluginHookAgentEndEvent,
  PluginHookBeforePromptBuildEvent,
  PluginHookBeforePromptBuildResult,
} from "../../../plugins/hook-types.js";
import type { EmbeddedRunAttemptResult } from "../run/types.js";

export const PI_ISOLATION_PROTOCOL = "genesis.pi-isolation";
export const PI_ISOLATION_PROTOCOL_VERSION = 1;
export const PI_ISOLATION_MAX_FRAME_BYTES = 32 * 1024 * 1024;
export const PI_ISOLATION_MAX_QUEUED_BYTES = 64 * 1024 * 1024;

export const PI_ISOLATION_BRIDGED_HOOK_NAMES = ["before_prompt_build", "agent_end"] as const;
export type PiIsolationBridgedHookName = (typeof PI_ISOLATION_BRIDGED_HOOK_NAMES)[number];

export type PiIsolationWireError = {
  name: string;
  message: string;
  stack?: string;
  code?: string;
  status?: number | string;
  statusCode?: number | string;
  reason?: string;
  provider?: string;
  model?: string;
  profileId?: string;
  rawError?: string;
  error?: PiIsolationWireError;
  cause?: PiIsolationWireError;
};

export type PiIsolationToolDescriptor = {
  name: string;
  label: string;
  description: string;
  parameters: unknown;
  executionMode?: "sequential" | "parallel";
  ownerOnly?: boolean;
  displaySummary?: string;
  pluginMeta?: {
    pluginId: string;
    optional: boolean;
  };
};

export type PiIsolationCallbackName =
  | "partial_reply"
  | "assistant_message_start"
  | "block_reply"
  | "block_reply_flush"
  | "reasoning_stream"
  | "reasoning_end"
  | "tool_result"
  | "agent_event";

export type PiIsolationHelloFrame = PiIsolationFrameBase & {
  type: "hello";
  seq: 0;
  role: "child";
  pid: number;
  capabilities: readonly ["callbacks", "tool-bridge", "hook-bridge", "abort", "steer"];
};

export type PiIsolationParentFrame =
  | (PiIsolationFrameBase & {
      type: "start";
      attempt: Record<string, unknown>;
      trace: DiagnosticTraceContext;
      runtimeApiKey?: string;
      runtimeEnv?: Record<string, string>;
      resolvedTransport?: string;
      tools: PiIsolationToolDescriptor[];
      hookNames: PiIsolationBridgedHookName[];
      shouldEmitToolResult?: boolean;
      shouldEmitToolOutput?: boolean;
    })
  | (PiIsolationFrameBase & {
      type: "abort";
      reason?: PiIsolationWireError;
    })
  | (PiIsolationFrameBase & {
      type: "steer";
      commandId: string;
      text: string;
    })
  | (PiIsolationFrameBase & {
      type: "callback_result";
      callbackId: string;
      error?: PiIsolationWireError;
    })
  | (PiIsolationFrameBase & {
      type: "tool_update";
      bridgeCallId: string;
      update: unknown;
    })
  | (PiIsolationFrameBase & {
      type: "tool_result";
      bridgeCallId: string;
      result: unknown;
    })
  | (PiIsolationFrameBase & {
      type: "tool_error";
      bridgeCallId: string;
      error: PiIsolationWireError;
    })
  | (PiIsolationFrameBase & {
      type: "hook_result";
      requestId: string;
      hookName: "before_prompt_build";
      result?: PluginHookBeforePromptBuildResult;
      error?: PiIsolationWireError;
    });

export type PiIsolationChildFrame =
  | (PiIsolationFrameBase & {
      type: "ready";
      pid: number;
    })
  | (PiIsolationFrameBase & {
      type: "state";
      streaming: boolean;
      compacting: boolean;
    })
  | (PiIsolationFrameBase & {
      type: "callback";
      callbackId?: string;
      callback: PiIsolationCallbackName;
      payload?: unknown;
    })
  | (PiIsolationFrameBase & {
      type: "tool_call";
      bridgeCallId: string;
      toolCallId: string;
      toolName: string;
      params: unknown;
    })
  | (PiIsolationFrameBase & {
      type: "tool_abort";
      bridgeCallId: string;
    })
  | (PiIsolationFrameBase & {
      type: "hook_request";
      requestId: string;
      hookName: "before_prompt_build";
      event: PluginHookBeforePromptBuildEvent;
      context: PluginHookAgentContext;
    })
  | (PiIsolationFrameBase & {
      type: "hook_notification";
      hookName: "agent_end";
      event: PluginHookAgentEndEvent;
      context: PluginHookAgentContext;
    })
  | (PiIsolationFrameBase & {
      type: "control_result";
      commandId: string;
      accepted: boolean;
      error?: PiIsolationWireError;
    })
  | (PiIsolationFrameBase & {
      type: "result";
      result: Record<string, unknown>;
    })
  | (PiIsolationFrameBase & {
      type: "fatal";
      phase: "handshake" | "setup" | "run" | "protocol";
      error: PiIsolationWireError;
    });

type PiIsolationFrameBase = {
  protocol: typeof PI_ISOLATION_PROTOCOL;
  version: typeof PI_ISOLATION_PROTOCOL_VERSION;
  seq: number;
};

type FramePayload = Record<string, unknown> & { type: string };

export class PiIsolationProtocolError extends Error {
  readonly code = "PI_ISOLATION_PROTOCOL";

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "PiIsolationProtocolError";
  }
}

export function serializePiIsolationError(error: unknown, depth = 0): PiIsolationWireError {
  const record =
    error && typeof error === "object" ? (error as Record<string, unknown>) : undefined;
  const readString = (key: string): string | undefined => {
    const value = record?.[key];
    return typeof value === "string" ? value : undefined;
  };
  const readStatus = (key: "status" | "statusCode"): number | string | undefined => {
    const value = record?.[key];
    if (typeof value === "number") {
      return Number.isFinite(value) ? value : undefined;
    }
    return typeof value === "string" ? value : undefined;
  };
  const cause =
    depth < 4 && record?.cause !== undefined
      ? serializePiIsolationError(record.cause, depth + 1)
      : undefined;
  const nestedError =
    depth < 4 && record?.error !== undefined
      ? serializePiIsolationError(record.error, depth + 1)
      : undefined;
  const isError = error instanceof Error;
  return {
    name: (isError ? error.name : readString("name")) || "Error",
    message:
      (isError ? error.message : readString("message")) ||
      (typeof error === "string" ? error : String(error)),
    ...(isError && error.stack ? { stack: error.stack } : {}),
    ...(readString("code") ? { code: readString("code") } : {}),
    ...(readStatus("status") !== undefined ? { status: readStatus("status") } : {}),
    ...(readStatus("statusCode") !== undefined ? { statusCode: readStatus("statusCode") } : {}),
    ...(readString("reason") ? { reason: readString("reason") } : {}),
    ...(readString("provider") ? { provider: readString("provider") } : {}),
    ...(readString("model") ? { model: readString("model") } : {}),
    ...(readString("profileId") ? { profileId: readString("profileId") } : {}),
    ...(readString("rawError") ? { rawError: readString("rawError") } : {}),
    ...(nestedError ? { error: nestedError } : {}),
    ...(cause ? { cause } : {}),
  };
}

export function deserializePiIsolationError(error: PiIsolationWireError): Error {
  const cause = error.cause ? deserializePiIsolationError(error.cause) : undefined;
  const nestedError = error.error ? deserializePiIsolationError(error.error) : undefined;
  const result = new Error(error.message, cause ? { cause } : undefined) as Error & {
    code?: string;
    status?: number | string;
    statusCode?: number | string;
    reason?: string;
    provider?: string;
    model?: string;
    profileId?: string;
    rawError?: string;
    error?: Error;
  };
  result.name = error.name || "Error";
  if (error.stack) {
    result.stack = error.stack;
  }
  if (error.code) {
    result.code = error.code;
  }
  if (error.status !== undefined) {
    result.status = error.status;
  }
  if (error.statusCode !== undefined) {
    result.statusCode = error.statusCode;
  }
  for (const key of ["reason", "provider", "model", "profileId", "rawError"] as const) {
    if (error[key] !== undefined) {
      result[key] = error[key];
    }
  }
  if (nestedError) {
    result.error = nestedError;
  }
  return result;
}

export function assertPiIsolationFrame(
  value: unknown,
): asserts value is PiIsolationFrameBase & FramePayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PiIsolationProtocolError("PI isolation frame must be a JSON object");
  }
  const frame = value as Record<string, unknown>;
  if (frame.protocol !== PI_ISOLATION_PROTOCOL) {
    throw new PiIsolationProtocolError("PI isolation frame has an invalid protocol id");
  }
  if (frame.version !== PI_ISOLATION_PROTOCOL_VERSION) {
    throw new PiIsolationProtocolError(
      `Unsupported PI isolation protocol version: ${String(frame.version)}`,
    );
  }
  if (!Number.isSafeInteger(frame.seq) || (frame.seq as number) < 0) {
    throw new PiIsolationProtocolError("PI isolation frame has an invalid sequence number");
  }
  if (typeof frame.type !== "string" || !frame.type) {
    throw new PiIsolationProtocolError("PI isolation frame is missing a type");
  }
}

export class PiIsolationSequenceGuard {
  #next = 1;

  accept(seq: number): "accepted" | "duplicate" {
    if (!Number.isSafeInteger(seq) || seq < 1) {
      throw new PiIsolationProtocolError(`Invalid PI isolation sequence: ${seq}`);
    }
    if (seq < this.#next) {
      return "duplicate";
    }
    if (seq !== this.#next) {
      throw new PiIsolationProtocolError(
        `PI isolation sequence gap: expected ${this.#next}, received ${seq}`,
      );
    }
    this.#next += 1;
    return "accepted";
  }
}

export function createPiIsolationJsonlDecoder(params: {
  onFrame: (frame: unknown, frameBytes: number) => void;
  onError: (error: Error) => void;
  maxFrameBytes?: number;
}) {
  const maxFrameBytes = params.maxFrameBytes ?? PI_ISOLATION_MAX_FRAME_BYTES;
  let buffer: Buffer = Buffer.alloc(0);
  let failed = false;

  const fail = (error: Error) => {
    if (failed) {
      return;
    }
    failed = true;
    buffer = Buffer.alloc(0);
    params.onError(error);
  };

  return {
    push(chunk: Buffer | string): void {
      if (failed) {
        return;
      }
      const incoming = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, "utf8");
      buffer = buffer.length === 0 ? incoming : Buffer.concat([buffer, incoming]);
      while (true) {
        const lfIndex = buffer.indexOf(0x0a);
        if (lfIndex === -1) {
          if (buffer.length > maxFrameBytes) {
            fail(new PiIsolationProtocolError("PI isolation frame exceeds the size limit"));
          }
          return;
        }
        if (lfIndex > maxFrameBytes) {
          fail(new PiIsolationProtocolError("PI isolation frame exceeds the size limit"));
          return;
        }
        let line = buffer.subarray(0, lfIndex);
        buffer = buffer.subarray(lfIndex + 1);
        if (line.at(-1) === 0x0d) {
          line = line.subarray(0, -1);
        }
        if (line.length === 0) {
          fail(new PiIsolationProtocolError("PI isolation protocol does not allow empty frames"));
          return;
        }
        try {
          params.onFrame(JSON.parse(line.toString("utf8")), line.length);
        } catch (error) {
          fail(
            error instanceof PiIsolationProtocolError
              ? error
              : new PiIsolationProtocolError("Invalid PI isolation JSON frame", { cause: error }),
          );
          return;
        }
      }
    },
    end(): void {
      if (!failed && buffer.length > 0) {
        fail(new PiIsolationProtocolError("PI isolation stream ended with a partial frame"));
      }
    },
  };
}

export class PiIsolationJsonlWriter {
  readonly #stream: Writable;
  readonly #maxFrameBytes: number;
  readonly #maxQueuedBytes: number;
  #nextSequence = 1;
  #pendingBytes = 0;
  #tail: Promise<void> = Promise.resolve();

  constructor(stream: Writable, options?: { maxFrameBytes?: number; maxQueuedBytes?: number }) {
    this.#stream = stream;
    this.#maxFrameBytes = options?.maxFrameBytes ?? PI_ISOLATION_MAX_FRAME_BYTES;
    this.#maxQueuedBytes = options?.maxQueuedBytes ?? PI_ISOLATION_MAX_QUEUED_BYTES;
  }

  send(payload: FramePayload): Promise<void> {
    let encoded: Buffer;
    try {
      encoded = Buffer.from(
        `${JSON.stringify({
          ...payload,
          protocol: PI_ISOLATION_PROTOCOL,
          version: PI_ISOLATION_PROTOCOL_VERSION,
          seq: this.#nextSequence,
        })}\n`,
        "utf8",
      );
    } catch (error) {
      return Promise.reject(
        new PiIsolationProtocolError("PI isolation frame is not JSON serializable", {
          cause: error,
        }),
      );
    }
    if (encoded.length - 1 > this.#maxFrameBytes) {
      return Promise.reject(
        new PiIsolationProtocolError("PI isolation frame exceeds the size limit"),
      );
    }
    if (this.#pendingBytes + encoded.length > this.#maxQueuedBytes) {
      return Promise.reject(
        new PiIsolationProtocolError("PI isolation output queue exceeds the backpressure limit"),
      );
    }
    this.#nextSequence += 1;
    this.#pendingBytes += encoded.length;
    const write = this.#tail.then(
      () =>
        new Promise<void>((resolve, reject) => {
          this.#stream.write(encoded, (error) => {
            if (error) {
              reject(error);
            } else {
              resolve();
            }
          });
        }),
    );
    this.#tail = write.catch(() => undefined);
    return write.finally(() => {
      this.#pendingBytes -= encoded.length;
    });
  }

  flush(): Promise<void> {
    return this.#tail;
  }
}

export function createPiIsolationHelloFrame(pid: number): PiIsolationHelloFrame {
  return {
    protocol: PI_ISOLATION_PROTOCOL,
    version: PI_ISOLATION_PROTOCOL_VERSION,
    seq: 0,
    type: "hello",
    role: "child",
    pid,
    capabilities: ["callbacks", "tool-bridge", "hook-bridge", "abort", "steer"],
  };
}

export function parsePiIsolationBridgedHookNames(value: unknown): PiIsolationBridgedHookName[] {
  if (!Array.isArray(value)) {
    throw new PiIsolationProtocolError("PI isolation start frame has invalid hook names");
  }
  const supported = new Set<string>(PI_ISOLATION_BRIDGED_HOOK_NAMES);
  const names = value.map((entry) => {
    if (typeof entry !== "string" || !supported.has(entry)) {
      throw new PiIsolationProtocolError("PI isolation start frame has invalid hook names");
    }
    return entry as PiIsolationBridgedHookName;
  });
  if (new Set(names).size !== names.length) {
    throw new PiIsolationProtocolError("PI isolation start frame has duplicate hook names");
  }
  return names;
}

export function serializePiIsolationAttemptResult(
  result: EmbeddedRunAttemptResult,
): Record<string, unknown> {
  const {
    setTerminalLifecycleMeta: _setTerminalLifecycleMeta,
    flushTerminalLifecycleEvent: _flushTerminalLifecycleEvent,
    promptError,
    ...serializable
  } = result;
  return {
    ...serializable,
    promptError: promptError == null ? null : serializePiIsolationError(promptError),
  };
}

export function deserializePiIsolationAttemptResult(
  value: Record<string, unknown>,
): EmbeddedRunAttemptResult {
  const promptError = value.promptError;
  return {
    ...(value as unknown as EmbeddedRunAttemptResult),
    promptError:
      promptError && typeof promptError === "object" && !Array.isArray(promptError)
        ? deserializePiIsolationError(promptError as PiIsolationWireError)
        : null,
  };
}
