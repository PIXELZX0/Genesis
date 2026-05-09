import { ConsoleLogger, LogService, setMatrixConsoleLogging } from "../sdk/logger.js";

let matrixSdkLoggingConfigured = false;
let matrixSdkLogMode: "default" | "quiet" = "default";
const matrixSdkBaseLogger = new ConsoleLogger();

type MatrixJsSdkLogger = {
  trace: (...messageOrObject: unknown[]) => void;
  debug: (...messageOrObject: unknown[]) => void;
  info: (...messageOrObject: unknown[]) => void;
  warn: (...messageOrObject: unknown[]) => void;
  error: (...messageOrObject: unknown[]) => void;
  getChild: (namespace: string) => MatrixJsSdkLogger;
};

function shouldSuppressMatrixHttpNotFound(module: string, messageOrObject: unknown[]): boolean {
  if (!module.includes("MatrixHttpClient")) {
    return false;
  }
  return messageOrObject.some((entry) => {
    if (!entry || typeof entry !== "object") {
      return false;
    }
    return (entry as { errcode?: string }).errcode === "M_NOT_FOUND";
  });
}

function isMatrixSyncRequestAbortError(value: unknown): boolean {
  if (!(value instanceof Error) || value.name !== "AbortError") {
    return false;
  }
  const message = value.message;
  const match = /Matrix request aborted before completion:\s+(\S+)/.exec(message);
  if (!match?.[1]) {
    return false;
  }
  try {
    const url = new URL(match[1]);
    return /^\/_matrix\/client\/v\d+\/sync$/.test(url.pathname);
  } catch {
    return message.includes("/_matrix/client/v3/sync");
  }
}

function shouldDowngradeMatrixSyncAbort(module: string, messageOrObject: unknown[]): boolean {
  if (!module.includes("MatrixClient.sync")) {
    return false;
  }
  const hasSyncErrorMessage = messageOrObject.some(
    (entry) => typeof entry === "string" && entry.includes("/sync error"),
  );
  if (!hasSyncErrorMessage) {
    return false;
  }
  return messageOrObject.some((entry) => isMatrixSyncRequestAbortError(entry));
}

export function ensureMatrixSdkLoggingConfigured(): void {
  if (!matrixSdkLoggingConfigured) {
    matrixSdkLoggingConfigured = true;
  }
  applyMatrixSdkLogger();
}

export function setMatrixSdkLogMode(mode: "default" | "quiet"): void {
  matrixSdkLogMode = mode;
  if (!matrixSdkLoggingConfigured) {
    return;
  }
  applyMatrixSdkLogger();
}

export function setMatrixSdkConsoleLogging(enabled: boolean): void {
  setMatrixConsoleLogging(enabled);
}

export function createMatrixJsSdkClientLogger(prefix = "matrix"): MatrixJsSdkLogger {
  return createMatrixJsSdkLoggerInstance(prefix);
}

function applyMatrixSdkLogger(): void {
  if (matrixSdkLogMode === "quiet") {
    LogService.setLogger({
      trace: () => {},
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
    });
    return;
  }

  LogService.setLogger({
    trace: (module, ...messageOrObject) => matrixSdkBaseLogger.trace(module, ...messageOrObject),
    debug: (module, ...messageOrObject) => matrixSdkBaseLogger.debug(module, ...messageOrObject),
    info: (module, ...messageOrObject) => matrixSdkBaseLogger.info(module, ...messageOrObject),
    warn: (module, ...messageOrObject) => matrixSdkBaseLogger.warn(module, ...messageOrObject),
    error: (module, ...messageOrObject) => {
      if (shouldSuppressMatrixHttpNotFound(module, messageOrObject)) {
        return;
      }
      if (shouldDowngradeMatrixSyncAbort(module, messageOrObject)) {
        matrixSdkBaseLogger.debug(module, ...messageOrObject);
        return;
      }
      matrixSdkBaseLogger.error(module, ...messageOrObject);
    },
  });
}

function createMatrixJsSdkLoggerInstance(prefix: string): MatrixJsSdkLogger {
  const log = (method: keyof ConsoleLogger, ...messageOrObject: unknown[]): void => {
    if (matrixSdkLogMode === "quiet") {
      return;
    }
    (matrixSdkBaseLogger[method] as (module: string, ...args: unknown[]) => void)(
      prefix,
      ...messageOrObject,
    );
  };

  return {
    trace: (...messageOrObject) => log("trace", ...messageOrObject),
    debug: (...messageOrObject) => log("debug", ...messageOrObject),
    info: (...messageOrObject) => log("info", ...messageOrObject),
    warn: (...messageOrObject) => log("warn", ...messageOrObject),
    error: (...messageOrObject) => {
      if (shouldSuppressMatrixHttpNotFound(prefix, messageOrObject)) {
        return;
      }
      if (shouldDowngradeMatrixSyncAbort(prefix, messageOrObject)) {
        log("debug", ...messageOrObject);
        return;
      }
      log("error", ...messageOrObject);
    },
    getChild: (namespace: string) => {
      const nextNamespace = namespace.trim();
      return createMatrixJsSdkLoggerInstance(nextNamespace ? `${prefix}.${nextNamespace}` : prefix);
    },
  };
}
