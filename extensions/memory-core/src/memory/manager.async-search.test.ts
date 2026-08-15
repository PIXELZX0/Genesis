import { describe, expect, it, vi } from "vitest";
import {
  awaitPendingManagerWork,
  startAsyncSearchSync,
  startBackgroundGraphSync,
} from "./manager-async-state.js";

describe("memory search async sync", () => {
  it("does not await sync when searching", async () => {
    let releaseSync = () => {};
    const pending = new Promise<void>((resolve) => {
      releaseSync = () => resolve();
    });
    const syncMock = vi.fn(async () => {
      return pending;
    });
    const onError = vi.fn();

    startAsyncSearchSync({
      enabled: true,
      dirty: true,
      sessionsDirty: false,
      sync: syncMock,
      onError,
    });

    expect(syncMock).toHaveBeenCalledTimes(1);
    releaseSync();
    await pending;
    expect(onError).not.toHaveBeenCalled();
  });

  it("waits for in-flight search sync during close", async () => {
    let releaseSync = () => {};
    const pendingSync = new Promise<void>((resolve) => {
      releaseSync = () => resolve();
    });

    let closed = false;
    const closePromise = awaitPendingManagerWork({ pendingSync }).then(() => {
      closed = true;
    });

    await Promise.resolve();
    expect(closed).toBe(false);

    releaseSync();
    await closePromise;
  });

  it("defers the cold graph sync instead of blocking the caller", async () => {
    vi.useFakeTimers();
    try {
      const syncMock = vi.fn(async () => {});
      startBackgroundGraphSync({
        hasIndexedContent: false,
        sync: syncMock,
        onError: vi.fn(),
      });

      expect(syncMock).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(0);
      expect(syncMock).toHaveBeenCalledWith({ reason: "graph", force: true });
    } finally {
      vi.useRealTimers();
    }
  });

  it("skips the graph sync when the index already has content", async () => {
    vi.useFakeTimers();
    try {
      const syncMock = vi.fn(async () => {});
      startBackgroundGraphSync({
        hasIndexedContent: true,
        sync: syncMock,
        onError: vi.fn(),
      });

      await vi.advanceTimersByTimeAsync(0);
      expect(syncMock).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports graph sync failures without rejecting", async () => {
    vi.useFakeTimers();
    try {
      const onError = vi.fn();
      startBackgroundGraphSync({
        hasIndexedContent: false,
        sync: async () => {
          throw new Error("boom");
        },
        onError,
      });

      await vi.advanceTimersByTimeAsync(0);
      expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "boom" }));
    } finally {
      vi.useRealTimers();
    }
  });

  it("skips background search sync when search-triggered sync is disabled", () => {
    const syncMock = vi.fn(async () => {});
    startAsyncSearchSync({
      enabled: false,
      dirty: true,
      sessionsDirty: false,
      sync: syncMock,
      onError: vi.fn(),
    });
    expect(syncMock).not.toHaveBeenCalled();
  });
});
