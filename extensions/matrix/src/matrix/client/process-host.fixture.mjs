// Standalone fixture host for process-proxy tests. Speaks the same IPC protocol
// as process-host.ts against a fake in-memory client, so tests exercise the real
// fork + IPC + proxy path without pulling in matrix-js-sdk. Not shipped runtime.
import { EventEmitter } from "node:events";

const EVENT_NAMES = [
  "room.event",
  "room.message",
  "room.encrypted_event",
  "room.decrypted_event",
  "room.failed_decryption",
  "room.invite",
  "room.join",
  "sync.state",
  "sync.unexpected_error",
  "verification.summary",
];

function send(msg) {
  process.send?.(msg);
}

function serializeError(err) {
  const error = err instanceof Error ? err : new Error(String(err));
  const extra = {};
  for (const key of Object.keys(error)) {
    extra[key] = error[key];
  }
  return {
    __matrixHostError: true,
    name: error.name,
    message: error.message,
    stack: error.stack,
    extra,
  };
}

let client = null;
const abortControllers = new Map();

function makeFakeClient() {
  const emitter = new EventEmitter();
  return {
    on: (name, listener) => emitter.on(name, listener),
    hasPersistedSyncState: () => true,
    crypto: {
      decryptMedia: async (file) => Buffer.from(`decrypted:${file.url}`),
    },
    // Real MatrixClient method names mapped to fixture behaviors so the proxy's
    // typed stubs can reach them.
    getUserId: async () => "@fake:hs",
    resolveRoom: async (value) => value, // round-trip echo
    joinRoom: async (roomId) => {
      // Emit an event as a side effect so event forwarding can be exercised.
      emitter.emit("room.join", roomId, { event_id: "$join", type: "m.room.member" });
    },
    deleteOwnDevices: async () => {
      const err = new Error("kaboom");
      err.data = { session: "sess-123" };
      err.errcode = "M_FORBIDDEN";
      throw err;
    },
    start: async (opts) =>
      await new Promise((resolve, reject) => {
        const signal = opts?.abortSignal;
        if (signal) {
          if (signal.aborted) {
            reject(new Error("aborted"));
            return;
          }
          signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
          return;
        }
        resolve();
      }),
    getJoinedRooms: async () => {
      // Die without forwarding sync.unexpected_error, so the proxy must synthesize one.
      process.exit(1);
    },
  };
}

async function invoke(method, args) {
  if (method.startsWith("crypto.")) {
    const name = method.slice("crypto.".length);
    return await client.crypto[name](...args);
  }
  return await client[method](...args);
}

process.on("message", (raw) => {
  if (raw.type === "init") {
    client = makeFakeClient();
    for (const name of EVENT_NAMES) {
      client.on(name, (...eventArgs) => send({ type: "event", eventName: name, args: eventArgs }));
    }
    send({ type: "init-ack", hasPersistedSyncState: client.hasPersistedSyncState() });
    if (client.crypto) {
      send({ type: "crypto-state", available: true });
    }
    return;
  }
  if (raw.type === "call") {
    let args = raw.args;
    if (raw.method === "start" && raw.abortId !== undefined) {
      const controller = new AbortController();
      abortControllers.set(raw.abortId, controller);
      args = [{ ...args[0], abortSignal: controller.signal }];
    }
    invoke(raw.method, args)
      .then((result) => send({ type: "result", id: raw.id, ok: true, result }))
      .catch((error) =>
        send({ type: "result", id: raw.id, ok: false, error: serializeError(error) }),
      )
      .finally(() => {
        if (raw.abortId !== undefined) {
          abortControllers.delete(raw.abortId);
        }
      });
    return;
  }
  if (raw.type === "abort") {
    abortControllers.get(raw.abortId)?.abort();
  }
});
