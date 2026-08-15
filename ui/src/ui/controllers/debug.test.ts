import { describe, expect, it, vi } from "vitest";
import { loadDebug, type DebugState } from "./debug.ts";

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function createState(client: DebugState["client"]): DebugState {
  return {
    client,
    connected: true,
    debugLoading: false,
    debugStatus: { old: true } as never,
    debugHealth: { old: true } as never,
    debugModels: [{ id: "old" }],
    debugCallMethod: "",
    debugCallParams: "{}",
    debugCallResult: null,
    debugCallError: null,
  };
}

describe("loadDebug", () => {
  it("drops all results when the client disconnects while requests are pending", async () => {
    const status = createDeferred<unknown>();
    const health = createDeferred<unknown>();
    const models = createDeferred<unknown>();
    const request = vi.fn((method: string) => {
      if (method === "status") {
        return status.promise;
      }
      if (method === "health") {
        return health.promise;
      }
      if (method === "models.list") {
        return models.promise;
      }
      throw new Error(`Unexpected request: ${method}`);
    });
    const client = { request } as never;
    const state = createState(client);
    const loading = loadDebug(state);

    state.client = { request: vi.fn() } as never;
    state.connected = false;
    status.resolve({ fresh: true });
    health.resolve({ fresh: true });
    models.resolve([{ id: "fresh" }]);

    await loading;

    expect(state.debugStatus).toEqual({ old: true });
    expect(state.debugHealth).toEqual({ old: true });
    expect(state.debugModels).toEqual([{ id: "old" }]);
  });
});
