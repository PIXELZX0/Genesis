import { describe, expect, it, vi } from "vitest";
import type { ModelCatalogEntry } from "../types.ts";
import { loadModels } from "./models.ts";

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("loadModels", () => {
  it("bypasses a pre-existing request when explicitly refreshed", async () => {
    const initial = createDeferred<{ models: ModelCatalogEntry[] }>();
    const refreshed = createDeferred<{ models: ModelCatalogEntry[] }>();
    const request = vi
      .fn()
      .mockImplementationOnce(() => initial.promise)
      .mockImplementationOnce(() => refreshed.promise);
    const client = { request } as never;

    const initialLoad = loadModels(client);
    const refreshedLoad = loadModels(client, { refresh: true });

    expect(request).toHaveBeenCalledTimes(2);

    initial.resolve({ models: [{ id: "old", name: "Old", provider: "test" }] });
    refreshed.resolve({ models: [{ id: "new", name: "New", provider: "test" }] });

    await expect(initialLoad).resolves.toEqual([{ id: "old", name: "Old", provider: "test" }]);
    await expect(refreshedLoad).resolves.toEqual([{ id: "new", name: "New", provider: "test" }]);
  });
});
