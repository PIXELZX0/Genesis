import { formatMatrixErrorMessage } from "../errors.js";
import {
  MATRIX_CLIENT_EVENT_NAMES,
  type MatrixHostCall,
  type MatrixHostInit,
  type MatrixHostMessage,
  type MatrixProxyMessage,
  type MatrixSerializedError,
} from "./process-ipc.js";

// Minimal structural view of MatrixClient the host needs. Kept structural (not
// the MatrixClient class) so tests can drive createMatrixProcessHost with a fake
// client without importing matrix-js-sdk.
export type MatrixProcessHostClient = {
  on(eventName: string, listener: (...args: unknown[]) => void): unknown;
  hasPersistedSyncState(): boolean;
  crypto?: unknown;
};

export type MatrixProcessHostDeps = {
  send: (msg: MatrixProxyMessage) => void;
  createClient: (msg: MatrixHostInit) => MatrixProcessHostClient | Promise<MatrixProcessHostClient>;
};

function invokeMethod(
  client: MatrixProcessHostClient,
  method: string,
  args: unknown[],
): Promise<unknown> {
  if (method.startsWith("crypto.")) {
    const cryptoMethod = method.slice("crypto.".length);
    const crypto = client.crypto;
    if (!crypto || typeof crypto !== "object") {
      throw new Error("Matrix crypto is not available");
    }
    const fn = (crypto as Record<string, unknown>)[cryptoMethod];
    if (typeof fn !== "function") {
      throw new Error(`Unknown Matrix crypto method: ${cryptoMethod}`);
    }
    return Promise.resolve((fn as (...a: unknown[]) => unknown).apply(crypto, args));
  }
  const fn = (client as unknown as Record<string, unknown>)[method];
  if (typeof fn !== "function") {
    throw new Error(`Unknown Matrix client method: ${method}`);
  }
  return Promise.resolve((fn as (...a: unknown[]) => unknown).apply(client, args));
}

export function createMatrixProcessHost(deps: MatrixProcessHostDeps): {
  handleMessage: (raw: MatrixHostMessage) => void;
} {
  let clientPromise: Promise<MatrixProcessHostClient> | null = null;
  let lastCryptoAvailable = false;
  const abortControllers = new Map<number, AbortController>();

  const syncCryptoState = (client: MatrixProcessHostClient): void => {
    const available = Boolean(client.crypto);
    if (available !== lastCryptoAvailable) {
      lastCryptoAvailable = available;
      deps.send({ type: "crypto-state", available });
    }
  };

  const sendError = (id: number, err: unknown): void => {
    try {
      deps.send({ type: "result", id, ok: false, error: serializeError(err) });
    } catch {
      // An own-property value was not structured-cloneable (e.g. a function).
      // Fall back to a message-only error so the call still rejects cleanly.
      deps.send({
        type: "result",
        id,
        ok: false,
        error: {
          __matrixHostError: true,
          name: "Error",
          message: formatMatrixErrorMessage(err),
          extra: {},
        },
      });
    }
  };

  const handleInit = async (msg: MatrixHostInit): Promise<void> => {
    clientPromise = Promise.resolve(deps.createClient(msg));
    let client: MatrixProcessHostClient;
    try {
      client = await clientPromise;
    } catch (err) {
      // Surface construction failure through the normal error path so the parent
      // sees a sync failure instead of a silent hang.
      deps.send({ type: "event", eventName: "sync.unexpected_error", args: [toError(err)] });
      return;
    }
    for (const eventName of MATRIX_CLIENT_EVENT_NAMES) {
      const name: string = eventName;
      client.on(name, (...args: unknown[]) => {
        deps.send({ type: "event", eventName: name, args });
      });
    }
    deps.send({ type: "init-ack", hasPersistedSyncState: client.hasPersistedSyncState() });
    syncCryptoState(client);
  };

  const handleCall = async (msg: MatrixHostCall): Promise<void> => {
    if (!clientPromise) {
      sendError(msg.id, new Error("Matrix client process received a call before init"));
      return;
    }
    let client: MatrixProcessHostClient;
    try {
      client = await clientPromise;
    } catch (err) {
      sendError(msg.id, err);
      return;
    }
    try {
      let args = msg.args;
      if (msg.method === "start" && msg.abortId !== undefined) {
        // AbortSignal cannot cross IPC; reconstruct one locally and inject it.
        const controller = new AbortController();
        abortControllers.set(msg.abortId, controller);
        const opts = (args[0] ?? {}) as Record<string, unknown>;
        args = [{ ...opts, abortSignal: controller.signal }];
      }
      const result = await invokeMethod(client, msg.method, args);
      deps.send({ type: "result", id: msg.id, ok: true, result });
    } catch (err) {
      sendError(msg.id, err);
    } finally {
      if (msg.abortId !== undefined) {
        abortControllers.delete(msg.abortId);
      }
      syncCryptoState(client);
    }
  };

  const handleMessage = (raw: MatrixHostMessage): void => {
    if (raw.type === "init") {
      void handleInit(raw);
      return;
    }
    if (raw.type === "call") {
      void handleCall(raw);
      return;
    }
    if (raw.type === "abort") {
      abortControllers.get(raw.abortId)?.abort();
    }
  };

  return { handleMessage };
}

function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}

function serializeError(err: unknown): MatrixSerializedError {
  const error = err instanceof Error ? err : new Error(formatMatrixErrorMessage(err));
  const extra: Record<string, unknown> = {};
  for (const key of Object.keys(error)) {
    extra[key] = (error as unknown as Record<string, unknown>)[key];
  }
  return {
    __matrixHostError: true,
    name: error.name,
    message: error.message,
    stack: error.stack,
    extra,
  };
}

// Forked entry point. The proxy sets GENESIS_MATRIX_PROCESS_HOST=1 when it
// forks this module so importing it for its exported helpers (tests) has no
// side effects. matrix-js-sdk is imported lazily so importing this module never
// pulls the native/WASM crypto graph into the parent process.
function startMatrixProcessHost(): void {
  const host = createMatrixProcessHost({
    send: (msg) => {
      process.send?.(msg);
    },
    createClient: async (msg) => {
      const { MatrixClient } = await import("../sdk.js");
      return new MatrixClient(msg.homeserver, msg.accessToken, msg.opts);
    },
  });

  process.on("message", (raw: MatrixHostMessage) => {
    host.handleMessage(raw);
  });

  const reportUnexpected = (error: unknown): void => {
    try {
      process.send?.({ type: "event", eventName: "sync.unexpected_error", args: [toError(error)] });
    } catch {
      // Best effort — the parent also synthesizes one on unexpected child exit.
    }
    process.exit(1);
  };
  process.on("uncaughtException", reportUnexpected);
  process.on("unhandledRejection", reportUnexpected);
}

if (process.env.GENESIS_MATRIX_PROCESS_HOST === "1") {
  startMatrixProcessHost();
}
