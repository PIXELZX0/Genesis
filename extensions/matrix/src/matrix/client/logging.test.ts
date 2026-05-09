import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createMatrixJsSdkClientLogger,
  setMatrixSdkConsoleLogging,
  setMatrixSdkLogMode,
} from "./logging.js";

function createSyncAbortError(): Error {
  const error = new Error(
    "Matrix request aborted before completion: https://matrix.example.org/_matrix/client/v3/sync",
  );
  error.name = "AbortError";
  return error;
}

describe("Matrix SDK client logging", () => {
  afterEach(() => {
    setMatrixSdkConsoleLogging(false);
    setMatrixSdkLogMode("default");
    vi.restoreAllMocks();
  });

  it("downgrades transient /sync abort logs from error to debug", () => {
    setMatrixSdkConsoleLogging(true);
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const logger = createMatrixJsSdkClientLogger("MatrixClient").getChild("sync");
    logger.error("/sync error %s", createSyncAbortError());

    expect(errorSpy).not.toHaveBeenCalled();
    expect(debugSpy).toHaveBeenCalledTimes(1);
    expect(debugSpy.mock.calls[0]?.[0]).toContain("[MatrixClient.sync] /sync error");
  });

  it("keeps non-sync SDK errors at error level", () => {
    setMatrixSdkConsoleLogging(true);
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const logger = createMatrixJsSdkClientLogger("MatrixClient").getChild("sync");
    logger.error("/sync error %s", new Error("server returned 500"));

    expect(debugSpy).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0]?.[0]).toContain("[MatrixClient.sync] /sync error");
  });
});
