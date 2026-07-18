import type { PinnedDispatcherPolicy } from "genesis/plugin-sdk/ssrf-dispatcher";
import type { IFilterDefinition } from "matrix-js-sdk/lib/matrix.js";
import type { SsrFPolicy } from "../../runtime-api.js";
import type { MatrixClientEventMap } from "../sdk/types.js";

// Client constructor options — the exact JSON/structured-clone-safe shape that
// create-client.ts passes to `new MatrixClient(...)`. Kept in sync with the
// constructor opts in sdk.ts so the proxy and host agree on the payload.
export type MatrixProcessClientOpts = {
  userId?: string;
  password?: string;
  deviceId?: string;
  localTimeoutMs?: number;
  encryption?: boolean;
  initialSyncLimit?: number;
  syncFilter?: IFilterDefinition;
  storagePath?: string;
  recoveryKeyPath?: string;
  idbSnapshotPath?: string;
  cryptoDatabasePrefix?: string;
  autoBootstrapCrypto?: boolean;
  ssrfPolicy?: SsrFPolicy;
  dispatcherPolicy?: PinnedDispatcherPolicy;
};

// Every event the wrapper re-emits as plain data (see MatrixClientEventMap).
// The host subscribes to each and forwards it to the parent unchanged.
export const MATRIX_CLIENT_EVENT_NAMES = [
  "room.event",
  "room.message",
  "room.encrypted_event",
  "room.decrypted_event",
  "room.failed_decryption",
  "room.invite",
  "room.join",
  "sync.state",
  "sync.unexpected_error",
  "verification.summary",
] as const satisfies ReadonlyArray<keyof MatrixClientEventMap>;

// Parent -> child.
export type MatrixHostInit = {
  type: "init";
  homeserver: string;
  accessToken: string;
  opts: MatrixProcessClientOpts;
};
export type MatrixHostCall = {
  type: "call";
  id: number;
  method: string;
  args: unknown[];
  abortId?: number;
};
export type MatrixHostAbort = { type: "abort"; abortId: number };
export type MatrixHostMessage = MatrixHostInit | MatrixHostCall | MatrixHostAbort;

// Node's advanced (V8 structured-clone) IPC only carries name/message/stack on
// Error instances — arbitrary own props (matrix-js-sdk's .data/.errcode/
// .httpStatus, which every consumer duck-types) are dropped. So we serialize the
// error's own-enumerable fields explicitly and rebuild the Error on the parent.
export type MatrixSerializedError = {
  __matrixHostError: true;
  name: string;
  message: string;
  stack?: string;
  extra: Record<string, unknown>;
};

// Child -> parent.
export type MatrixProxyInitAck = { type: "init-ack"; hasPersistedSyncState: boolean };
export type MatrixProxyResult = {
  type: "result";
  id: number;
  ok: boolean;
  result?: unknown;
  error?: unknown;
};
export type MatrixProxyEvent = { type: "event"; eventName: string; args: unknown[] };
export type MatrixProxyCryptoState = { type: "crypto-state"; available: boolean };
export type MatrixProxyMessage =
  | MatrixProxyInitAck
  | MatrixProxyResult
  | MatrixProxyEvent
  | MatrixProxyCryptoState;
