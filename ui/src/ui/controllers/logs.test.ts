import { describe, expect, it, vi } from "vitest";
import { loadLogs, parseLogLine, type LogsState } from "./logs.ts";

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function createLogsState(request: ReturnType<typeof vi.fn>): LogsState {
  return {
    client: { request } as never,
    connected: true,
    logsLoading: false,
    logsError: null,
    logsCursor: null,
    logsFile: null,
    logsEntries: [],
    logsTruncated: false,
    logsLastFetchAt: null,
    logsLimit: 500,
    logsMaxBytes: 250_000,
  };
}

describe("parseLogLine", () => {
  it("prefers the human-readable message field when structured data is stored in slot 1", () => {
    const line = JSON.stringify({
      0: '{"subsystem":"gateway/ws"}',
      1: {
        cause: "unauthorized",
        authReason: "password_missing",
      },
      2: "closed before connect conn=abc code=4008 reason=connect failed",
      _meta: {
        date: "2026-03-13T19:07:12.128Z",
        logLevelName: "WARN",
      },
      time: "2026-03-13T14:07:12.138-05:00",
    });

    expect(parseLogLine(line)).toEqual(
      expect.objectContaining({
        level: "warn",
        subsystem: "gateway/ws",
        message: "closed before connect conn=abc code=4008 reason=connect failed",
      }),
    );
  });
});

describe("loadLogs", () => {
  it("coalesces quiet polls and trails one manual reset without overlap", async () => {
    const first = createDeferred<{ cursor: number; lines: string[] }>();
    const second = createDeferred<{ cursor: number; lines: string[]; reset: boolean }>();
    const request = vi
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const state = createLogsState(request);

    const initialLoad = loadLogs(state);
    const quietPoll = loadLogs(state, { quiet: true });
    const manualReset = loadLogs(state, { reset: true });

    expect(request).toHaveBeenCalledTimes(1);
    expect(state.logsLoading).toBe(true);

    first.resolve({ cursor: 1, lines: ["first"] });
    await initialLoad;

    expect(request).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenNthCalledWith(
      2,
      "logs.tail",
      { cursor: undefined, limit: 500, maxBytes: 250_000 },
      { timeoutMs: 5_000 },
    );
    expect(state.logsEntries.map((entry) => entry.message)).toEqual(["first"]);

    second.resolve({ cursor: 2, lines: ["second"], reset: true });
    await manualReset;

    expect(request).toHaveBeenCalledTimes(2);
    expect(state.logsEntries.map((entry) => entry.message)).toEqual(["second"]);
    expect(state.logsCursor).toBe(2);
    await quietPoll;
  });

  it("ignores a response after the state switches clients", async () => {
    const pending = createDeferred<{ cursor: number; lines: string[] }>();
    const request = vi.fn().mockReturnValue(pending.promise);
    const state = createLogsState(request);
    const load = loadLogs(state);

    state.client = { request: vi.fn() } as never;
    pending.resolve({ cursor: 1, lines: ["stale"] });
    await load;

    expect(state.logsEntries).toEqual([]);
    expect(state.logsCursor).toBeNull();
    expect(state.logsFile).toBeNull();
  });
});
