import fs from "node:fs";
import type { PinnedDispatcherPolicy } from "genesis/plugin-sdk/ssrf-dispatcher";
import {
  ssrfPolicyFromDangerouslyAllowPrivateNetwork,
  type SsrFPolicy,
} from "genesis/plugin-sdk/ssrf-runtime";
import { normalizeOptionalString } from "genesis/plugin-sdk/string-coerce-runtime";
import type { MatrixClient } from "../sdk.js";
import { resolveValidatedMatrixHomeserverUrl } from "./config.js";
import {
  maybeMigrateLegacyStorage,
  resolveMatrixStoragePaths,
  writeStorageMeta,
} from "./storage.js";

type MatrixCreateClientRuntimeDeps = {
  MatrixClient: typeof import("../sdk.js").MatrixClient;
  ensureMatrixSdkLoggingConfigured: typeof import("./logging.js").ensureMatrixSdkLoggingConfigured;
};

let matrixCreateClientRuntimeDepsPromise: Promise<MatrixCreateClientRuntimeDeps> | undefined;

async function loadMatrixCreateClientRuntimeDeps(): Promise<MatrixCreateClientRuntimeDeps> {
  matrixCreateClientRuntimeDepsPromise ??= Promise.all([
    import("../sdk.js"),
    import("./logging.js"),
  ]).then(([sdkModule, loggingModule]) => ({
    MatrixClient: sdkModule.MatrixClient,
    ensureMatrixSdkLoggingConfigured: loggingModule.ensureMatrixSdkLoggingConfigured,
  }));
  return await matrixCreateClientRuntimeDepsPromise;
}

export async function createMatrixClient(params: {
  homeserver: string;
  userId?: string;
  accessToken: string;
  password?: string;
  deviceId?: string;
  persistStorage?: boolean;
  encryption?: boolean;
  localTimeoutMs?: number;
  initialSyncLimit?: number;
  accountId?: string | null;
  autoBootstrapCrypto?: boolean;
  processIsolation?: boolean;
  allowPrivateNetwork?: boolean;
  ssrfPolicy?: SsrFPolicy;
  dispatcherPolicy?: PinnedDispatcherPolicy;
}): Promise<MatrixClient> {
  const { MatrixClient, ensureMatrixSdkLoggingConfigured } =
    await loadMatrixCreateClientRuntimeDeps();
  ensureMatrixSdkLoggingConfigured();
  const homeserver = await resolveValidatedMatrixHomeserverUrl(params.homeserver, {
    dangerouslyAllowPrivateNetwork: params.allowPrivateNetwork,
  });
  const matrixClientUserId = normalizeOptionalString(params.userId);
  const userId = matrixClientUserId ?? "unknown";
  const persistStorage = params.persistStorage !== false;
  const storagePaths = persistStorage
    ? resolveMatrixStoragePaths({
        homeserver,
        userId,
        accessToken: params.accessToken,
        accountId: params.accountId,
        deviceId: params.deviceId,
        env: process.env,
      })
    : null;

  if (storagePaths) {
    await maybeMigrateLegacyStorage({
      storagePaths,
      env: process.env,
    });
    fs.mkdirSync(storagePaths.rootDir, { recursive: true });
    writeStorageMeta({
      storagePaths,
      homeserver,
      userId,
      accountId: params.accountId,
      deviceId: params.deviceId,
    });
  }

  const cryptoDatabasePrefix = storagePaths
    ? `genesis-matrix-${storagePaths.accountKey}-${storagePaths.tokenHash}`
    : undefined;

  const clientOpts = {
    userId: matrixClientUserId,
    password: params.password,
    deviceId: params.deviceId,
    encryption: params.encryption,
    localTimeoutMs: params.localTimeoutMs,
    initialSyncLimit: params.initialSyncLimit,
    storagePath: storagePaths?.storagePath,
    recoveryKeyPath: storagePaths?.recoveryKeyPath,
    idbSnapshotPath: storagePaths?.idbSnapshotPath,
    cryptoDatabasePrefix,
    autoBootstrapCrypto: params.autoBootstrapCrypto,
    ssrfPolicy:
      params.ssrfPolicy ?? ssrfPolicyFromDangerouslyAllowPrivateNetwork(params.allowPrivateNetwork),
    dispatcherPolicy: params.dispatcherPolicy,
  };

  if (params.processIsolation) {
    // Run the client (matrix-js-sdk + WASM/native crypto) in a child_process so a
    // synchronous Megolm key-share can never block the gateway event loop. The proxy
    // has the same public surface as MatrixClient; the cast bridges TypeScript's
    // nominal check on MatrixClient's private fields (structurally identical at runtime).
    const { MatrixClientProcessProxy } = await import("./process-proxy.js");
    return new MatrixClientProcessProxy(
      homeserver,
      params.accessToken,
      clientOpts,
    ) as unknown as MatrixClient;
  }

  return new MatrixClient(homeserver, params.accessToken, clientOpts);
}
