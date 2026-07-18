import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { createMatrixProcessHost, type MatrixProcessHostClient } from "./process-host.js";
import type { MatrixHostInit, MatrixProxyMessage } from "./process-ipc.js";

const INIT: MatrixHostInit = {
  type: "init",
  homeserver: "https://hs.example",
  accessToken: "token",
  opts: { encryption: true },
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function makeFakeClient(overrides: Record<string, unknown> = {}): {
  client: MatrixProcessHostClient;
  emitter: EventEmitter;
} {
  const emitter = new EventEmitter();
  const client = {
    on: (name: string, listener: (...args: unknown[]) => void) => emitter.on(name, listener),
    hasPersistedSyncState: () => true,
    crypto: {
      decryptMedia: async (file: { url: string }) => Buffer.from(`decrypted:${file.url}`),
    },
    getUserId: async () => "@fake:hs",
    boom: async () => {
      const err = new Error("kaboom");
      (err as unknown as { data: unknown }).data = { session: "sess-123" };
      throw err;
    },
    ...overrides,
  } as unknown as MatrixProcessHostClient;
  return { client, emitter };
}

function setup(clientOverrides?: Record<string, unknown>) {
  const sent: MatrixProxyMessage[] = [];
  const { client, emitter } = makeFakeClient(clientOverrides);
  const host = createMatrixProcessHost({
    send: (msg) => sent.push(msg),
    createClient: () => client,
  });
  return { host, sent, emitter };
}

describe("createMatrixProcessHost", () => {
  it("acks init with persisted sync state and reports crypto availability", async () => {
    const { host, sent } = setup();
    host.handleMessage(INIT);
    await flush();
    expect(sent).toContainEqual({ type: "init-ack", hasPersistedSyncState: true });
    expect(sent).toContainEqual({ type: "crypto-state", available: true });
  });

  it("dispatches a plain method call", async () => {
    const { host, sent } = setup();
    host.handleMessage(INIT);
    host.handleMessage({ type: "call", id: 1, method: "getUserId", args: [] });
    await flush();
    expect(sent).toContainEqual({ type: "result", id: 1, ok: true, result: "@fake:hs" });
  });

  it("dispatches a dotted crypto.* call", async () => {
    const { host, sent } = setup();
    host.handleMessage(INIT);
    host.handleMessage({
      type: "call",
      id: 2,
      method: "crypto.decryptMedia",
      args: [{ url: "mxc://hs/x" }],
    });
    await flush();
    const result = sent.find(
      (m): m is Extract<MatrixProxyMessage, { type: "result" }> =>
        m.type === "result" && m.id === 2,
    );
    expect(result?.ok).toBe(true);
    expect((result?.result as Buffer).toString()).toBe("decrypted:mxc://hs/x");
  });

  it("passes thrown-error extra fields through the failure result", async () => {
    const { host, sent } = setup();
    host.handleMessage(INIT);
    host.handleMessage({ type: "call", id: 3, method: "boom", args: [] });
    await flush();
    const result = sent.find(
      (m): m is Extract<MatrixProxyMessage, { type: "result" }> =>
        m.type === "result" && m.id === 3,
    );
    expect(result?.ok).toBe(false);
    // Errors are serialized into a tagged POJO because V8 IPC drops extra
    // own-props on Error instances; the parent rebuilds the Error from this.
    expect(result?.error).toMatchObject({
      __matrixHostError: true,
      message: "kaboom",
      extra: { data: { session: "sess-123" } },
    });
  });

  it("forwards client events to the parent", async () => {
    const { host, sent, emitter } = setup();
    host.handleMessage(INIT);
    await flush();
    emitter.emit("room.message", "!room:hs", { event_id: "$1" });
    expect(sent).toContainEqual({
      type: "event",
      eventName: "room.message",
      args: ["!room:hs", { event_id: "$1" }],
    });
  });

  it("errors on an unknown method", async () => {
    const { host, sent } = setup();
    host.handleMessage(INIT);
    host.handleMessage({ type: "call", id: 4, method: "nope", args: [] });
    await flush();
    const result = sent.find(
      (m): m is Extract<MatrixProxyMessage, { type: "result" }> =>
        m.type === "result" && m.id === 4,
    );
    expect(result?.ok).toBe(false);
  });

  it("errors when a call arrives before init", async () => {
    const { host, sent } = setup();
    host.handleMessage({ type: "call", id: 5, method: "getUserId", args: [] });
    await flush();
    const result = sent.find(
      (m): m is Extract<MatrixProxyMessage, { type: "result" }> =>
        m.type === "result" && m.id === 5,
    );
    expect(result?.ok).toBe(false);
  });
});
