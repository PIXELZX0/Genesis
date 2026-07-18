import { type ChildProcess, fork } from "node:child_process";
import { EventEmitter } from "node:events";
import { fileURLToPath } from "node:url";
import type { IPresenceOpts } from "matrix-js-sdk";
import type {
  MatrixDeviceVerificationStatus,
  MatrixOwnCrossSigningPublicationStatus,
  MatrixOwnDeviceDeleteResult,
  MatrixOwnDeviceInfo,
  MatrixOwnDeviceVerificationStatus,
  MatrixRecoveryKeyVerificationResult,
  MatrixRoomKeyBackupResetResult,
  MatrixRoomKeyBackupRestoreResult,
  MatrixRoomKeyBackupStatus,
  MatrixVerificationBootstrapResult,
} from "../sdk.js";
import type { MatrixCryptoFacade } from "../sdk/crypto-facade.js";
import type { HttpMethod, QueryParams } from "../sdk/transport.js";
import type {
  MatrixClientEventMap,
  MatrixRawEvent,
  MatrixRelationsPage,
  MessageEventContent,
} from "../sdk/types.js";
import {
  type MatrixHostCall,
  type MatrixProcessClientOpts,
  type MatrixProxyMessage,
  type MatrixSerializedError,
} from "./process-ipc.js";

const SHUTDOWN_TIMEOUT_MS = 5_000;

let hostModuleOverride: string | undefined;

/** Test-only: point the proxy at a fixture host module instead of process-host.js. */
export function setMatrixClientProcessHostModuleForTest(modulePath?: string): void {
  hostModuleOverride = modulePath;
}

function reviveMatrixHostError(error: unknown): unknown {
  if (
    error &&
    typeof error === "object" &&
    (error as { __matrixHostError?: unknown }).__matrixHostError === true
  ) {
    const payload = error as MatrixSerializedError;
    const revived = new Error(payload.message);
    revived.name = payload.name;
    if (payload.stack) {
      revived.stack = payload.stack;
    }
    Object.assign(revived, payload.extra);
    return revived;
  }
  return error;
}

function defaultHostModulePath(): string {
  // Resolve the host as a sibling with the SAME extension as this module (.js
  // when compiled, .ts under a TS loader). fork() inherits process.execArgv, so
  // a loader like `--import tsx` carries into the child for the .ts case.
  const url = new URL(import.meta.url);
  url.pathname = url.pathname.replace(/process-proxy(\.[^./]+)$/, "process-host$1");
  return fileURLToPath(url);
}

type PendingCall = {
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
  cleanup?: () => void;
};

/**
 * Parent-side stand-in for MatrixClient. Every method forwards to a child
 * process running the real client (see process-host.ts) over IPC, so the
 * synchronous WASM/native crypto work can never block the gateway event loop.
 * Public method signatures mirror MatrixClient exactly; create-client.ts bridges
 * the nominal type gap with a documented cast.
 */
export class MatrixClientProcessProxy {
  private readonly child: ChildProcess;
  private readonly emitter = new EventEmitter();
  private readonly pending = new Map<number, PendingCall>();
  private nextCallId = 0;
  private nextAbortId = 0;
  private persistedSyncState = false;
  private expectingExit = false;
  private unexpectedErrorForwarded = false;
  private readonly dmRoomIds = new Set<string>();

  crypto?: MatrixCryptoFacade;

  private readonly cryptoFacade: MatrixCryptoFacade = {
    prepare: (joinedRooms) => this.callRemote("crypto.prepare", [joinedRooms]),
    updateSyncData: (a, b, c, d, e) => this.callRemote("crypto.updateSyncData", [a, b, c, d, e]),
    isRoomEncrypted: (roomId) => this.callRemote("crypto.isRoomEncrypted", [roomId]),
    requestOwnUserVerification: () => this.callRemote("crypto.requestOwnUserVerification", []),
    encryptMedia: (buffer) => this.callRemote("crypto.encryptMedia", [buffer]),
    decryptMedia: (file, opts) => this.callRemote("crypto.decryptMedia", [file, opts]),
    getRecoveryKey: () => this.callRemote("crypto.getRecoveryKey", []),
    listVerifications: () => this.callRemote("crypto.listVerifications", []),
    ensureVerificationDmTracked: (params) =>
      this.callRemote("crypto.ensureVerificationDmTracked", [params]),
    requestVerification: (params) => this.callRemote("crypto.requestVerification", [params]),
    acceptVerification: (id) => this.callRemote("crypto.acceptVerification", [id]),
    cancelVerification: (id, params) => this.callRemote("crypto.cancelVerification", [id, params]),
    startVerification: (id, method) => this.callRemote("crypto.startVerification", [id, method]),
    generateVerificationQr: (id) => this.callRemote("crypto.generateVerificationQr", [id]),
    scanVerificationQr: (id, qr) => this.callRemote("crypto.scanVerificationQr", [id, qr]),
    confirmVerificationSas: (id) => this.callRemote("crypto.confirmVerificationSas", [id]),
    mismatchVerificationSas: (id) => this.callRemote("crypto.mismatchVerificationSas", [id]),
    confirmVerificationReciprocateQr: (id) =>
      this.callRemote("crypto.confirmVerificationReciprocateQr", [id]),
    getVerificationSas: (id) => this.callRemote("crypto.getVerificationSas", [id]),
  };

  readonly dms = {
    // Refresh a proxy-local DM cache from m.direct so isDm() can stay synchronous
    // (the source-of-truth set lives in the child). Mirrors sdk.ts refreshDmCache.
    update: async (): Promise<boolean> => {
      const direct = await this.getAccountData("m.direct");
      this.dmRoomIds.clear();
      if (!direct || typeof direct !== "object") {
        return false;
      }
      for (const value of Object.values(direct)) {
        if (!Array.isArray(value)) {
          continue;
        }
        for (const roomId of value) {
          if (typeof roomId === "string" && roomId.trim()) {
            this.dmRoomIds.add(roomId);
          }
        }
      }
      return true;
    },
    isDm: (roomId: string): boolean => this.dmRoomIds.has(roomId),
  };

  constructor(
    private readonly homeserver: string,
    accessToken: string,
    opts: MatrixProcessClientOpts = {},
  ) {
    this.child = fork(hostModuleOverride ?? defaultHostModulePath(), [], {
      serialization: "advanced",
      env: { ...process.env, GENESIS_MATRIX_PROCESS_HOST: "1" },
    });
    this.child.on("message", (raw: MatrixProxyMessage) => {
      this.handleMessage(raw);
    });
    this.child.on("error", (error) => {
      this.onChildDown(error);
    });
    this.child.on("exit", () => {
      this.onChildDown(new Error("Matrix client process exited unexpectedly"));
    });
    this.child.send({ type: "init", homeserver, accessToken, opts });
  }

  private handleMessage(raw: MatrixProxyMessage): void {
    switch (raw.type) {
      case "init-ack":
        this.persistedSyncState = raw.hasPersistedSyncState;
        return;
      case "result": {
        const entry = this.pending.get(raw.id);
        if (!entry) {
          return;
        }
        this.pending.delete(raw.id);
        entry.cleanup?.();
        if (raw.ok) {
          entry.resolve(raw.result);
        } else {
          entry.reject(reviveMatrixHostError(raw.error));
        }
        return;
      }
      case "event":
        if (raw.eventName === "sync.unexpected_error") {
          this.unexpectedErrorForwarded = true;
        }
        this.safeEmit(raw.eventName, raw.args);
        return;
      case "crypto-state":
        this.crypto = raw.available ? this.cryptoFacade : undefined;
        return;
    }
  }

  private onChildDown(error: Error): void {
    if (this.expectingExit) {
      return;
    }
    this.expectingExit = true;
    for (const [id, entry] of this.pending) {
      this.pending.delete(id);
      entry.cleanup?.();
      entry.reject(error);
    }
    // If the child died before it could forward its own sync.unexpected_error,
    // synthesize one so the monitor's restart path still fires.
    if (!this.unexpectedErrorForwarded) {
      this.unexpectedErrorForwarded = true;
      this.safeEmit("sync.unexpected_error", [error]);
    }
  }

  // Isolate listener failures from the IPC loop, matching MatrixClient.emitClientEvent.
  private safeEmit(eventName: string, args: unknown[]): void {
    for (const listener of this.emitter.listeners(eventName)) {
      try {
        const result = (listener as (...a: unknown[]) => unknown)(...args);
        if (result && typeof (result as { then?: unknown }).then === "function") {
          void Promise.resolve(result).catch(() => undefined);
        }
      } catch {
        // Listener errors must not break the message loop.
      }
    }
  }

  private callRemote<T>(method: string, args: unknown[], abortSignal?: AbortSignal): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (!this.child.connected) {
        reject(new Error("Matrix client process is not connected"));
        return;
      }
      const id = ++this.nextCallId;
      let abortId: number | undefined;
      let cleanup: (() => void) | undefined;
      if (abortSignal) {
        abortId = ++this.nextAbortId;
        const capturedAbortId = abortId;
        const onAbort = () => {
          if (this.child.connected) {
            this.child.send({ type: "abort", abortId: capturedAbortId });
          }
        };
        abortSignal.addEventListener("abort", onAbort, { once: true });
        cleanup = () => abortSignal.removeEventListener("abort", onAbort);
      }
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, cleanup });
      const msg: MatrixHostCall = {
        type: "call",
        id,
        method,
        args,
        ...(abortId !== undefined ? { abortId } : {}),
      };
      this.child.send(msg, (err) => {
        if (err) {
          const entry = this.pending.get(id);
          if (entry) {
            this.pending.delete(id);
            entry.cleanup?.();
            entry.reject(err);
          }
        } else if (abortSignal?.aborted && abortId !== undefined && this.child.connected) {
          // The signal was already aborted before the call landed; tell the host now.
          this.child.send({ type: "abort", abortId });
        }
      });
    });
  }

  private async shutdown(method: "stop" | "stopAndPersist"): Promise<void> {
    if (this.expectingExit) {
      return;
    }
    this.expectingExit = true;
    try {
      await Promise.race([
        this.callRemote<void>(method, []),
        new Promise<void>((resolve) => {
          setTimeout(resolve, SHUTDOWN_TIMEOUT_MS).unref?.();
        }),
      ]);
    } catch {
      // Ignore shutdown errors — we kill the child regardless.
    }
    for (const [id, entry] of this.pending) {
      this.pending.delete(id);
      entry.cleanup?.();
      entry.reject(new Error("Matrix client process stopped"));
    }
    if (this.child.connected) {
      this.child.disconnect();
    }
    this.child.kill();
  }

  // --- Public MatrixClient surface -----------------------------------------

  on<TEvent extends keyof MatrixClientEventMap>(
    eventName: TEvent,
    listener: (...args: MatrixClientEventMap[TEvent]) => void,
  ): this;
  on(eventName: string, listener: (...args: unknown[]) => void): this;
  on(eventName: string, listener: (...args: unknown[]) => void): this {
    this.emitter.on(eventName, listener as (...args: unknown[]) => void);
    return this;
  }

  off<TEvent extends keyof MatrixClientEventMap>(
    eventName: TEvent,
    listener: (...args: MatrixClientEventMap[TEvent]) => void,
  ): this;
  off(eventName: string, listener: (...args: unknown[]) => void): this;
  off(eventName: string, listener: (...args: unknown[]) => void): this {
    this.emitter.off(eventName, listener as (...args: unknown[]) => void);
    return this;
  }

  async start(opts: { abortSignal?: AbortSignal; readyTimeoutMs?: number } = {}): Promise<void> {
    const { abortSignal, ...rest } = opts;
    await this.callRemote<void>("start", [rest], abortSignal);
  }

  async prepareForOneOff(): Promise<void> {
    await this.callRemote<void>("prepareForOneOff", []);
  }

  hasPersistedSyncState(): boolean {
    // ponytail: snapshot from init; only caller reads it once at monitor startup
    // to decide backlog replay, and it reflects the *previous* process's clean
    // shutdown, which does not change after construction.
    return this.persistedSyncState;
  }

  stopSyncWithoutPersist(): void {
    void this.callRemote<void>("stopSyncWithoutPersist", []).catch(() => undefined);
  }

  async drainPendingDecryptions(reason = "matrix client shutdown"): Promise<void> {
    await this.callRemote<void>("drainPendingDecryptions", [reason]);
  }

  stop(): void {
    void this.shutdown("stop");
  }

  async stopAndPersist(): Promise<void> {
    await this.shutdown("stopAndPersist");
  }

  async getUserId(): Promise<string> {
    return await this.callRemote<string>("getUserId", []);
  }

  async getJoinedRooms(): Promise<string[]> {
    return await this.callRemote<string[]>("getJoinedRooms", []);
  }

  async getJoinedRoomMembers(roomId: string): Promise<string[]> {
    return await this.callRemote<string[]>("getJoinedRoomMembers", [roomId]);
  }

  async getRoomStateEvent(
    roomId: string,
    eventType: string,
    stateKey = "",
  ): Promise<Record<string, unknown>> {
    return await this.callRemote("getRoomStateEvent", [roomId, eventType, stateKey]);
  }

  async getAccountData(eventType: string): Promise<Record<string, unknown> | undefined> {
    return await this.callRemote("getAccountData", [eventType]);
  }

  async setAccountData(eventType: string, content: Record<string, unknown>): Promise<void> {
    await this.callRemote<void>("setAccountData", [eventType, content]);
  }

  async resolveRoom(aliasOrRoomId: string): Promise<string | null> {
    return await this.callRemote("resolveRoom", [aliasOrRoomId]);
  }

  async createDirectRoom(
    remoteUserId: string,
    opts: { encrypted?: boolean } = {},
  ): Promise<string> {
    return await this.callRemote<string>("createDirectRoom", [remoteUserId, opts]);
  }

  async sendMessage(roomId: string, content: MessageEventContent): Promise<string> {
    return await this.callRemote<string>("sendMessage", [roomId, content]);
  }

  async sendEvent(
    roomId: string,
    eventType: string,
    content: Record<string, unknown>,
  ): Promise<string> {
    return await this.callRemote<string>("sendEvent", [roomId, eventType, content]);
  }

  async sendStateEvent(
    roomId: string,
    eventType: string,
    stateKey: string,
    content: Record<string, unknown>,
  ): Promise<string> {
    return await this.callRemote<string>("sendStateEvent", [roomId, eventType, stateKey, content]);
  }

  async redactEvent(roomId: string, eventId: string, reason?: string): Promise<string> {
    return await this.callRemote<string>("redactEvent", [roomId, eventId, reason]);
  }

  async doRequest(
    method: HttpMethod,
    endpoint: string,
    qs?: QueryParams,
    body?: unknown,
    opts?: { allowAbsoluteEndpoint?: boolean },
  ): Promise<unknown> {
    return await this.callRemote("doRequest", [method, endpoint, qs, body, opts]);
  }

  async getUserProfile(userId: string): Promise<{ displayname?: string; avatar_url?: string }> {
    return await this.callRemote("getUserProfile", [userId]);
  }

  async setDisplayName(displayName: string): Promise<void> {
    await this.callRemote<void>("setDisplayName", [displayName]);
  }

  async setAvatarUrl(avatarUrl: string): Promise<void> {
    await this.callRemote<void>("setAvatarUrl", [avatarUrl]);
  }

  async setPresence(opts: IPresenceOpts): Promise<void> {
    await this.callRemote<void>("setPresence", [opts]);
  }

  async joinRoom(roomId: string): Promise<void> {
    await this.callRemote<void>("joinRoom", [roomId]);
  }

  mxcToHttp(mxcUrl: string): string | null {
    // Local pure transform (no callers today outside sdk.ts). Reproduces the
    // authenticated v1 media-download URL shape sdk.ts derives via mxcUrlToHttp.
    const match = /^mxc:\/\/([^/]+)\/(.+)$/.exec(mxcUrl);
    if (!match) {
      return null;
    }
    const [, server, mediaId] = match;
    const base = this.homeserver.replace(/\/+$/, "");
    return `${base}/_matrix/client/v1/media/download/${encodeURIComponent(server)}/${encodeURIComponent(mediaId)}`;
  }

  async downloadContent(
    mxcUrl: string,
    opts: { allowRemote?: boolean; maxBytes?: number; readIdleTimeoutMs?: number } = {},
  ): Promise<Buffer> {
    return await this.callRemote<Buffer>("downloadContent", [mxcUrl, opts]);
  }

  async uploadContent(file: Buffer, contentType?: string, filename?: string): Promise<string> {
    return await this.callRemote<string>("uploadContent", [file, contentType, filename]);
  }

  async getEvent(roomId: string, eventId: string): Promise<Record<string, unknown>> {
    return await this.callRemote("getEvent", [roomId, eventId]);
  }

  async getRelations(
    roomId: string,
    eventId: string,
    relationType: string | null,
    eventType?: string | null,
    opts: { from?: string } = {},
  ): Promise<MatrixRelationsPage> {
    return await this.callRemote("getRelations", [roomId, eventId, relationType, eventType, opts]);
  }

  async hydrateEvents(
    roomId: string,
    events: Array<Record<string, unknown>>,
  ): Promise<MatrixRawEvent[]> {
    return await this.callRemote("hydrateEvents", [roomId, events]);
  }

  async setTyping(roomId: string, typing: boolean, timeoutMs: number): Promise<void> {
    await this.callRemote<void>("setTyping", [roomId, typing, timeoutMs]);
  }

  async sendReadReceipt(roomId: string, eventId: string): Promise<void> {
    await this.callRemote<void>("sendReadReceipt", [roomId, eventId]);
  }

  async getRoomKeyBackupStatus(): Promise<MatrixRoomKeyBackupStatus> {
    return await this.callRemote("getRoomKeyBackupStatus", []);
  }

  async getDeviceVerificationStatus(
    userId: string | null | undefined,
    deviceId: string | null | undefined,
  ): Promise<MatrixDeviceVerificationStatus> {
    return await this.callRemote("getDeviceVerificationStatus", [userId, deviceId]);
  }

  async getOwnDeviceVerificationStatus(): Promise<MatrixOwnDeviceVerificationStatus> {
    return await this.callRemote("getOwnDeviceVerificationStatus", []);
  }

  async getOwnDeviceIdentityVerificationStatus(): Promise<MatrixDeviceVerificationStatus> {
    return await this.callRemote("getOwnDeviceIdentityVerificationStatus", []);
  }

  async trustOwnIdentityAfterSelfVerification(): Promise<void> {
    await this.callRemote<void>("trustOwnIdentityAfterSelfVerification", []);
  }

  async verifyWithRecoveryKey(
    rawRecoveryKey: string,
  ): Promise<MatrixRecoveryKeyVerificationResult> {
    return await this.callRemote("verifyWithRecoveryKey", [rawRecoveryKey]);
  }

  async restoreRoomKeyBackup(
    params: { recoveryKey?: string } = {},
  ): Promise<MatrixRoomKeyBackupRestoreResult> {
    return await this.callRemote("restoreRoomKeyBackup", [params]);
  }

  async resetRoomKeyBackup(): Promise<MatrixRoomKeyBackupResetResult> {
    return await this.callRemote("resetRoomKeyBackup", []);
  }

  async getOwnCrossSigningPublicationStatus(): Promise<MatrixOwnCrossSigningPublicationStatus> {
    return await this.callRemote("getOwnCrossSigningPublicationStatus", []);
  }

  async bootstrapOwnDeviceVerification(params?: {
    allowAutomaticCrossSigningReset?: boolean;
    recoveryKey?: string;
    forceResetCrossSigning?: boolean;
    strict?: boolean;
  }): Promise<MatrixVerificationBootstrapResult> {
    return await this.callRemote("bootstrapOwnDeviceVerification", [params]);
  }

  async listOwnDevices(): Promise<MatrixOwnDeviceInfo[]> {
    return await this.callRemote("listOwnDevices", []);
  }

  async deleteOwnDevices(deviceIds: string[]): Promise<MatrixOwnDeviceDeleteResult> {
    return await this.callRemote("deleteOwnDevices", [deviceIds]);
  }

  async ensureRoomKeyBackup(): Promise<MatrixRoomKeyBackupStatus> {
    return await this.callRemote("ensureRoomKeyBackup", []);
  }
}
