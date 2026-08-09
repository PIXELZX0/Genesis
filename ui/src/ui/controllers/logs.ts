import type { GatewayBrowserClient } from "../gateway.ts";
import { normalizeLowercaseStringOrEmpty } from "../string-coerce.ts";
import type { LogEntry, LogLevel } from "../types.ts";
import {
  formatMissingOperatorReadScopeMessage,
  isMissingOperatorReadScopeError,
} from "./scope-errors.ts";

export type LogsState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  logsLoading: boolean;
  logsError: string | null;
  logsCursor: number | null;
  logsFile: string | null;
  logsEntries: LogEntry[];
  logsTruncated: boolean;
  logsLastFetchAt: number | null;
  logsLimit: number;
  logsMaxBytes: number;
};

const LOG_BUFFER_LIMIT = 2000;
export const LOG_TAIL_REQUEST_TIMEOUT_MS = 5_000;
const LEVELS = new Set<LogLevel>(["trace", "debug", "info", "warn", "error", "fatal"]);

type LogsLoadControl = {
  inFlight: Promise<void> | null;
  pendingReset: {
    promise: Promise<void>;
    resolve: () => void;
  } | null;
};

const logsLoadControls = new WeakMap<object, LogsLoadControl>();

function getLogsLoadControl(state: LogsState): LogsLoadControl {
  const key = state as object;
  let control = logsLoadControls.get(key);
  if (!control) {
    control = { inFlight: null, pendingReset: null };
    logsLoadControls.set(key, control);
  }
  return control;
}

function parseMaybeJsonString(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    return null;
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function normalizeLevel(value: unknown): LogLevel | null {
  if (typeof value !== "string") {
    return null;
  }
  const lowered = normalizeLowercaseStringOrEmpty(value) as LogLevel;
  return LEVELS.has(lowered) ? lowered : null;
}

export function parseLogLine(line: string): LogEntry {
  if (!line.trim()) {
    return { raw: line, message: line };
  }
  try {
    const obj = JSON.parse(line) as Record<string, unknown>;
    const meta =
      obj && typeof obj._meta === "object" && obj._meta !== null
        ? (obj._meta as Record<string, unknown>)
        : null;
    const time =
      typeof obj.time === "string" ? obj.time : typeof meta?.date === "string" ? meta?.date : null;
    const level = normalizeLevel(meta?.logLevelName ?? meta?.level);

    const contextCandidate =
      typeof obj["0"] === "string" ? obj["0"] : typeof meta?.name === "string" ? meta?.name : null;
    const contextObj = parseMaybeJsonString(contextCandidate);
    let subsystem =
      typeof contextObj?.subsystem === "string"
        ? contextObj.subsystem
        : typeof contextObj?.module === "string"
          ? contextObj.module
          : null;
    if (!subsystem && contextCandidate && contextCandidate.length < 120) {
      subsystem = contextCandidate;
    }

    const message =
      typeof obj["1"] === "string"
        ? obj["1"]
        : typeof obj["2"] === "string"
          ? obj["2"]
          : !contextObj && typeof obj["0"] === "string"
            ? obj["0"]
            : typeof obj.message === "string"
              ? obj.message
              : line;

    return {
      raw: line,
      time,
      level,
      subsystem,
      message,
      meta: meta ?? undefined,
    };
  } catch {
    return { raw: line, message: line };
  }
}

export function loadLogs(
  state: LogsState,
  opts?: { reset?: boolean; quiet?: boolean },
): Promise<void> {
  const quiet = opts?.quiet === true;
  const control = getLogsLoadControl(state);
  if (control.inFlight) {
    if (!opts?.reset) {
      return control.inFlight;
    }
    if (!control.pendingReset) {
      let resolve!: () => void;
      const promise = new Promise<void>((resolvePromise) => {
        resolve = resolvePromise;
      });
      control.pendingReset = { promise, resolve };
    }
    return control.pendingReset.promise;
  }

  const client = state.client;
  if (!client || !state.connected) {
    return Promise.resolve();
  }
  if (!quiet) {
    state.logsLoading = true;
  }
  state.logsError = null;
  let request: Promise<void>;
  request = (async () => {
    try {
      const res = await client.request(
        "logs.tail",
        {
          cursor: opts?.reset ? undefined : (state.logsCursor ?? undefined),
          limit: state.logsLimit,
          maxBytes: state.logsMaxBytes,
        },
        { timeoutMs: LOG_TAIL_REQUEST_TIMEOUT_MS },
      );
      if (state.client !== client || !state.connected) {
        return;
      }
      const payload = res as {
        file?: string;
        cursor?: number;
        lines?: unknown;
        truncated?: boolean;
        reset?: boolean;
      };
      const lines = Array.isArray(payload.lines)
        ? payload.lines.filter((line) => typeof line === "string")
        : [];
      const entries = lines.map(parseLogLine);
      const shouldReset = opts?.reset || payload.reset || state.logsCursor == null;
      state.logsEntries = shouldReset
        ? entries
        : [...state.logsEntries, ...entries].slice(-LOG_BUFFER_LIMIT);
      state.logsCursor = typeof payload.cursor === "number" ? payload.cursor : state.logsCursor;
      state.logsFile = typeof payload.file === "string" ? payload.file : state.logsFile;
      state.logsTruncated = Boolean(payload.truncated);
      state.logsLastFetchAt = Date.now();
    } catch (err) {
      if (state.client !== client || !state.connected) {
        return;
      }
      if (isMissingOperatorReadScopeError(err)) {
        state.logsEntries = [];
        state.logsError = formatMissingOperatorReadScopeMessage("logs");
      } else {
        state.logsError = String(err);
      }
    } finally {
      if (!quiet) {
        state.logsLoading = false;
      }
    }
  })();
  control.inFlight = request;
  const finish = () => {
    if (control.inFlight !== request) {
      return;
    }
    const pendingReset = control.pendingReset;
    control.inFlight = null;
    control.pendingReset = null;
    if (!pendingReset) {
      return;
    }
    if (!state.client || !state.connected) {
      pendingReset.resolve();
      return;
    }
    void loadLogs(state, { reset: true }).then(pendingReset.resolve, pendingReset.resolve);
  };
  void request.then(finish, finish);
  return request;
}
