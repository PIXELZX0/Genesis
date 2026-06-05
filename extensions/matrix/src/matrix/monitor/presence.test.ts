import type { IPresenceOpts } from "matrix-js-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CoreConfig, MatrixPresenceConfig } from "../../types.js";
import {
  applyMatrixPresence,
  resolveMatrixPresenceConfig,
  type MatrixMonitorPresenceLog,
} from "./presence.js";

function makeConfig(presence?: MatrixPresenceConfig): CoreConfig {
  return {
    channels: {
      matrix: presence ? { presence } : {},
    },
  };
}

function makeLog(): MatrixMonitorPresenceLog {
  return {
    info: vi.fn() as unknown as MatrixMonitorPresenceLog["info"],
    warn: vi.fn() as unknown as MatrixMonitorPresenceLog["warn"],
    debug: vi.fn() as unknown as NonNullable<MatrixMonitorPresenceLog["debug"]>,
  };
}

describe("resolveMatrixPresenceConfig", () => {
  it("defaults to online when no presence config is provided", () => {
    expect(resolveMatrixPresenceConfig(undefined)).toEqual({ presence: "online" });
    expect(resolveMatrixPresenceConfig({ channels: {} })).toEqual({ presence: "online" });
    expect(resolveMatrixPresenceConfig(makeConfig(undefined))).toEqual({ presence: "online" });
  });

  it("passes through explicit online state", () => {
    expect(resolveMatrixPresenceConfig(makeConfig({ state: "online" }))).toEqual({
      presence: "online",
    });
  });

  it("supports unavailable and offline states", () => {
    expect(resolveMatrixPresenceConfig(makeConfig({ state: "unavailable" }))).toEqual({
      presence: "unavailable",
    });
    expect(resolveMatrixPresenceConfig(makeConfig({ state: "offline" }))).toEqual({
      presence: "offline",
    });
  });

  it("normalises case-insensitive input", () => {
    const cfg = makeConfig({ state: "ONLINE" as unknown as MatrixPresenceConfig["state"] });
    expect(resolveMatrixPresenceConfig(cfg)).toEqual({
      presence: "online",
    });
  });

  it("attaches status_msg only for online state", () => {
    expect(
      resolveMatrixPresenceConfig(makeConfig({ state: "online", statusMessage: "ready" })),
    ).toEqual({ presence: "online", status_msg: "ready" });
    expect(
      resolveMatrixPresenceConfig(makeConfig({ state: "unavailable", statusMessage: "ready" })),
    ).toEqual({ presence: "unavailable" });
  });

  it("drops empty status messages", () => {
    expect(
      resolveMatrixPresenceConfig(makeConfig({ state: "online", statusMessage: "   " })),
    ).toEqual({ presence: "online" });
  });

  it("rejects invalid states", () => {
    expect(() => resolveMatrixPresenceConfig(makeConfig({ state: "away" as never }))).toThrow(
      /invalid presence state "away"/,
    );
  });
});

describe("applyMatrixPresence", () => {
  let setPresenceMock: ReturnType<typeof vi.fn>;
  let client: { setPresence: (opts: IPresenceOpts) => Promise<void> };

  beforeEach(() => {
    setPresenceMock = vi.fn(async () => undefined);
    client = { setPresence: setPresenceMock as unknown as (opts: IPresenceOpts) => Promise<void> };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("publishes online presence by default", async () => {
    const log = makeLog();
    const result = await applyMatrixPresence({ client, cfg: undefined, log });
    expect(setPresenceMock).toHaveBeenCalledWith({ presence: "online" });
    expect(result).toEqual({ applied: true, state: "online" });
    expect(log.info).toHaveBeenCalledWith(expect.stringMatching(/state=online/));
  });

  it("passes through the configured state and status message", async () => {
    const log = makeLog();
    const cfg = makeConfig({ state: "online", statusMessage: "helping" });
    const result = await applyMatrixPresence({ client, cfg, log });
    expect(setPresenceMock).toHaveBeenCalledWith({ presence: "online", status_msg: "helping" });
    expect(result).toEqual({ applied: true, state: "online", statusMessage: "helping" });
  });

  it("returns aborted without calling setPresence when the signal is already aborted", async () => {
    const log = makeLog();
    const controller = new AbortController();
    controller.abort();
    const result = await applyMatrixPresence({
      client,
      cfg: undefined,
      log,
      abortSignal: controller.signal,
    });
    expect(setPresenceMock).not.toHaveBeenCalled();
    expect(result).toEqual({ applied: false, reason: "aborted" });
    expect(log.debug).toHaveBeenCalled();
  });

  it("logs a warning and resolves to no-op when setPresence rejects", async () => {
    const log = makeLog();
    setPresenceMock.mockRejectedValueOnce(new Error("homeserver 503"));
    const result = await applyMatrixPresence({ client, cfg: undefined, log });
    expect(result).toEqual({ applied: false, reason: "no-op" });
    expect(log.warn).toHaveBeenCalledWith(
      "matrix: failed to publish presence (non-fatal)",
      expect.objectContaining({ error: expect.stringContaining("503") }),
    );
  });
});
