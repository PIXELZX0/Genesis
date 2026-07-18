import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { MatrixRawEvent } from "../sdk/types.js";
import {
  MatrixClientProcessProxy,
  setMatrixClientProcessHostModuleForTest,
} from "./process-proxy.js";

const FIXTURE_HOST = fileURLToPath(new URL("./process-host.fixture.mjs", import.meta.url));

describe("MatrixClientProcessProxy", () => {
  const proxies: MatrixClientProcessProxy[] = [];

  beforeAll(() => {
    setMatrixClientProcessHostModuleForTest(FIXTURE_HOST);
  });
  afterAll(() => {
    setMatrixClientProcessHostModuleForTest(undefined);
  });
  afterEach(() => {
    for (const proxy of proxies.splice(0)) {
      proxy.stop();
    }
  });

  const spawn = (): MatrixClientProcessProxy => {
    const proxy = new MatrixClientProcessProxy("https://hs.example", "token", { encryption: true });
    proxies.push(proxy);
    return proxy;
  };

  it("completes the init handshake and reports persisted sync state", async () => {
    const proxy = spawn();
    // Round-trip a call first to guarantee init-ack has arrived.
    await expect(proxy.getUserId()).resolves.toBe("@fake:hs");
    expect(proxy.hasPersistedSyncState()).toBe(true);
  });

  it("round-trips a method call and a dotted crypto.* call", async () => {
    const proxy = spawn();
    await expect(proxy.resolveRoom("!room:hs")).resolves.toBe("!room:hs");
    // Wait for crypto-state to arrive, then call through the crypto facade.
    await expect(proxy.getUserId()).resolves.toBe("@fake:hs");
    expect(proxy.crypto).toBeDefined();
    const decrypted = await proxy.crypto?.decryptMedia({
      url: "mxc://hs/abc",
    } as never);
    expect(decrypted?.toString()).toBe("decrypted:mxc://hs/abc");
  });

  it("forwards child events to local listeners", async () => {
    const proxy = spawn();
    const received: Array<[string, MatrixRawEvent]> = [];
    proxy.on("room.join", (roomId, event) => {
      received.push([roomId, event]);
    });
    await proxy.joinRoom("!room:hs");
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(received).toEqual([["!room:hs", { event_id: "$join", type: "m.room.member" }]]);
  });

  it("preserves thrown-error extra fields across IPC", async () => {
    const proxy = spawn();
    await expect(proxy.deleteOwnDevices(["d1"])).rejects.toMatchObject({
      message: "kaboom",
      errcode: "M_FORBIDDEN",
      data: { session: "sess-123" },
    });
  });

  it("propagates abort to the child", async () => {
    const proxy = spawn();
    const controller = new AbortController();
    const started = proxy.start({ abortSignal: controller.signal });
    controller.abort();
    await expect(started).rejects.toThrow("aborted");
  });

  it("rejects in-flight calls and emits sync.unexpected_error on child crash", async () => {
    const proxy = spawn();
    const errors: Error[] = [];
    proxy.on("sync.unexpected_error", (error) => {
      errors.push(error);
    });
    const pending = proxy.getJoinedRooms();
    await expect(pending).rejects.toThrow(/exited unexpectedly/);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toMatch(/exited unexpectedly/);
  });
});
