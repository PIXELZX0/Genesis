import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CoreConfig } from "../../types.js";
import type { MatrixAccountPatch } from "../config-update.js";
import type { MatrixManagedDeviceInfo } from "../device-health.js";
import type { MatrixProfileSyncResult } from "../profile.js";
import type { MatrixOwnDeviceVerificationStatus } from "../sdk.js";
import type { MatrixLegacyCryptoRestoreResult } from "./legacy-crypto-restore.js";
import type { MatrixStartupVerificationOutcome } from "./startup-verification.js";
import type { MatrixStartupMaintenanceDeps } from "./startup.js";
import { runMatrixStartupMaintenance } from "./startup.js";

function createVerificationStatus(
  overrides: Partial<MatrixOwnDeviceVerificationStatus> = {},
): MatrixOwnDeviceVerificationStatus {
  return {
    encryptionEnabled: true,
    userId: "@bot:example.org",
    deviceId: "DEVICE",
    verified: false,
    localVerified: false,
    crossSigningVerified: false,
    signedByOwner: false,
    recoveryKeyStored: false,
    recoveryKeyCreatedAt: null,
    recoveryKeyId: null,
    backupVersion: null,
    backup: {
      serverVersion: null,
      activeVersion: null,
      trusted: null,
      matchesDecryptionKey: null,
      decryptionKeyCached: null,
      keyLoadAttempted: false,
      keyLoadError: null,
    },
    ...overrides,
  };
}

function createProfileSyncResult(
  overrides: Partial<MatrixProfileSyncResult> = {},
): MatrixProfileSyncResult {
  return {
    skipped: false,
    displayNameUpdated: false,
    avatarUpdated: false,
    resolvedAvatarUrl: null,
    uploadedAvatarSource: null,
    convertedAvatarFromHttp: false,
    ...overrides,
  };
}

function createStartupVerificationOutcome(
  kind: Exclude<MatrixStartupVerificationOutcome["kind"], "unsupported">,
  overrides: Partial<Extract<MatrixStartupVerificationOutcome, { kind: typeof kind }>> = {},
): MatrixStartupVerificationOutcome {
  return {
    kind,
    verification: createVerificationStatus({ verified: kind === "verified" }),
    ...overrides,
  } as MatrixStartupVerificationOutcome;
}

function createLegacyCryptoRestoreResult(
  overrides: Partial<MatrixLegacyCryptoRestoreResult> = {},
): MatrixLegacyCryptoRestoreResult {
  return {
    kind: "skipped",
    ...overrides,
  } as MatrixLegacyCryptoRestoreResult;
}

function createDeps(
  overrides: Partial<MatrixStartupMaintenanceDeps> = {},
): MatrixStartupMaintenanceDeps {
  return {
    maybeRestoreLegacyMatrixBackup: vi.fn(async () => createLegacyCryptoRestoreResult()),
    summarizeMatrixDeviceHealth: vi.fn(() => ({
      currentDeviceId: null,
      staleGenesisDevices: [] as MatrixManagedDeviceInfo[],
      currentGenesisDevices: [] as MatrixManagedDeviceInfo[],
    })),
    syncMatrixOwnProfile: vi.fn(async () => createProfileSyncResult()),
    ensureMatrixStartupVerification: vi.fn(async () =>
      createStartupVerificationOutcome("verified"),
    ),
    updateMatrixAccountConfig: vi.fn(
      (cfg: CoreConfig, _accountId: string, _patch: MatrixAccountPatch) => cfg,
    ),
    ...overrides,
  };
}

describe("runMatrixStartupMaintenance", () => {
  let deps: MatrixStartupMaintenanceDeps;

  beforeEach(() => {
    deps = createDeps();
  });

  function createParams(): Parameters<typeof runMatrixStartupMaintenance>[0] {
    return {
      client: {
        crypto: {},
        listOwnDevices: vi.fn(async () => []),
        deleteOwnDevices: vi.fn(async (deviceIds: string[]) => ({
          currentDeviceId: "DEVICE",
          deletedDeviceIds: deviceIds,
          remainingDevices: [],
        })),
        ensureRoomKeyBackup: vi.fn(async () => createVerificationStatus().backup),
        getOwnDeviceVerificationStatus: vi.fn(async () => createVerificationStatus()),
      } as never,
      auth: {
        accountId: "ops",
        homeserver: "https://matrix.example.org",
        userId: "@bot:example.org",
        accessToken: "token",
        encryption: false,
      },
      accountId: "ops",
      effectiveAccountId: "ops",
      accountConfig: {
        name: "Ops Bot",
        avatarUrl: "https://example.org/avatar.png",
      },
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
        error: vi.fn(),
      },
      logVerboseMessage: vi.fn(),
      loadConfig: vi.fn(() => ({ channels: { matrix: {} } })),
      writeConfigFile: vi.fn(async () => {}),
      loadWebMedia: vi.fn(async () => ({
        buffer: Buffer.from("avatar"),
        contentType: "image/png",
        fileName: "avatar.png",
      })),
      abortSignal: undefined,
      env: {},
    };
  }

  it("persists converted avatar URLs after profile sync", async () => {
    const params = createParams();
    const updatedCfg = { channels: { matrix: { avatarUrl: "mxc://avatar" } } };
    vi.mocked(deps.syncMatrixOwnProfile).mockResolvedValue(
      createProfileSyncResult({
        avatarUpdated: true,
        resolvedAvatarUrl: "mxc://avatar",
        uploadedAvatarSource: "http",
        convertedAvatarFromHttp: true,
      }),
    );
    vi.mocked(deps.updateMatrixAccountConfig).mockReturnValue(updatedCfg);

    await runMatrixStartupMaintenance(params, deps);

    expect(deps.syncMatrixOwnProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "@bot:example.org",
        displayName: "Ops Bot",
        avatarUrl: "https://example.org/avatar.png",
      }),
    );
    expect(deps.updateMatrixAccountConfig).toHaveBeenCalledWith(
      { channels: { matrix: {} } },
      "ops",
      { avatarUrl: "mxc://avatar" },
    );
    expect(params.writeConfigFile).toHaveBeenCalledWith(updatedCfg as never);
    expect(params.logVerboseMessage).toHaveBeenCalledWith(
      "matrix: persisted converted avatar URL for account ops (mxc://avatar)",
    );
  });

  it("reports stale devices, pending verification, and restored legacy backups", async () => {
    const params = createParams();
    params.auth.encryption = true;
    vi.mocked(deps.summarizeMatrixDeviceHealth).mockReturnValue({
      currentDeviceId: null,
      staleGenesisDevices: [{ deviceId: "DEV123", displayName: "Genesis Device", current: false }],
      currentGenesisDevices: [],
    });
    vi.mocked(deps.ensureMatrixStartupVerification).mockResolvedValue(
      createStartupVerificationOutcome("pending"),
    );
    vi.mocked(deps.maybeRestoreLegacyMatrixBackup).mockResolvedValue(
      createLegacyCryptoRestoreResult({
        kind: "restored",
        imported: 2,
        total: 3,
        localOnlyKeys: 1,
      }),
    );

    await runMatrixStartupMaintenance(params, deps);

    expect(params.logger.warn).toHaveBeenCalledWith(
      "matrix: stale Genesis devices detected for @bot:example.org: DEV123. Run 'genesis matrix devices prune-stale --account ops' to keep encrypted-room trust healthy.",
    );
    expect(params.logger.info).toHaveBeenCalledWith(
      "matrix: device not verified — run 'genesis matrix verify device <key>' to enable E2EE",
    );
    expect(params.logger.info).toHaveBeenCalledWith(
      "matrix: startup verification request is already pending; finish it in another Matrix client",
    );
    expect(params.logger.info).toHaveBeenCalledWith(
      "matrix: restored 2/3 room key(s) from legacy encrypted-state backup",
    );
    expect(params.logger.warn).toHaveBeenCalledWith(
      "matrix: 1 legacy local-only room key(s) were never backed up and could not be restored automatically",
    );
  });

  it("auto-prunes stale Genesis devices idle past the threshold", async () => {
    const params = createParams();
    params.auth.encryption = true;
    const staleLastSeen = Date.now() - 8 * 24 * 60 * 60 * 1000;
    vi.mocked(deps.summarizeMatrixDeviceHealth).mockReturnValue({
      currentDeviceId: "DEVICE",
      staleGenesisDevices: [
        {
          deviceId: "OLD1",
          displayName: "Genesis Gateway",
          current: false,
          lastSeenTs: staleLastSeen,
        },
        { deviceId: "NOSEEN", displayName: "Genesis Gateway", current: false, lastSeenTs: null },
      ],
      currentGenesisDevices: [],
    });

    await runMatrixStartupMaintenance(params, deps);

    expect(params.client.deleteOwnDevices).toHaveBeenCalledWith(["OLD1"]);
    expect(params.logger.info).toHaveBeenCalledWith(
      "matrix: auto-pruned 1 stale Genesis device(s) for @bot:example.org: OLD1",
    );
    expect(params.logger.warn).toHaveBeenCalledWith(
      "matrix: stale Genesis devices detected for @bot:example.org: NOSEEN. Run 'genesis matrix devices prune-stale --account ops' to keep encrypted-room trust healthy.",
    );
  });

  it("skips auto-pruning when autoPruneStaleDevices is false", async () => {
    const params = createParams();
    params.auth.encryption = true;
    params.accountConfig.autoPruneStaleDevices = false;
    vi.mocked(deps.summarizeMatrixDeviceHealth).mockReturnValue({
      currentDeviceId: "DEVICE",
      staleGenesisDevices: [
        {
          deviceId: "OLD1",
          displayName: "Genesis Gateway",
          current: false,
          lastSeenTs: Date.now() - 8 * 24 * 60 * 60 * 1000,
        },
      ],
      currentGenesisDevices: [],
    });

    await runMatrixStartupMaintenance(params, deps);

    expect(params.client.deleteOwnDevices).not.toHaveBeenCalled();
    expect(params.logger.warn).toHaveBeenCalledWith(
      "matrix: stale Genesis devices detected for @bot:example.org: OLD1. Run 'genesis matrix devices prune-stale --account ops' to keep encrypted-room trust healthy.",
    );
  });

  it("keeps startup going when auto-prune or backup bootstrap fails", async () => {
    const params = createParams();
    params.auth.encryption = true;
    vi.mocked(params.client.deleteOwnDevices).mockRejectedValue(new Error("uia required"));
    vi.mocked(params.client.ensureRoomKeyBackup).mockRejectedValue(new Error("backup boom"));
    vi.mocked(deps.summarizeMatrixDeviceHealth).mockReturnValue({
      currentDeviceId: "DEVICE",
      staleGenesisDevices: [
        {
          deviceId: "OLD1",
          displayName: "Genesis Gateway",
          current: false,
          lastSeenTs: Date.now() - 8 * 24 * 60 * 60 * 1000,
        },
      ],
      currentGenesisDevices: [],
    });

    await runMatrixStartupMaintenance(params, deps);

    expect(params.logger.warn).toHaveBeenCalledWith(
      "matrix: failed auto-pruning stale Genesis devices for @bot:example.org: Error: uia required",
    );
    expect(params.logger.warn).toHaveBeenCalledWith(
      "matrix: failed ensuring room key backup: Error: backup boom",
    );
    expect(deps.ensureMatrixStartupVerification).toHaveBeenCalled();
  });

  it("reports room key backup readiness after startup bootstrap", async () => {
    const params = createParams();
    params.auth.encryption = true;
    vi.mocked(params.client.ensureRoomKeyBackup).mockResolvedValue({
      serverVersion: "3",
      activeVersion: "3",
      trusted: true,
      matchesDecryptionKey: true,
      decryptionKeyCached: true,
      keyLoadAttempted: false,
      keyLoadError: null,
    });

    await runMatrixStartupMaintenance(params, deps);

    expect(params.logVerboseMessage).toHaveBeenCalledWith(
      "matrix: room key backup ready (version 3, active=3)",
    );
  });

  it("logs cooldown and request-failure verification outcomes without throwing", async () => {
    const params = createParams();
    params.auth.encryption = true;
    vi.mocked(deps.ensureMatrixStartupVerification).mockResolvedValueOnce(
      createStartupVerificationOutcome("cooldown", { retryAfterMs: 321 }),
    );

    await runMatrixStartupMaintenance(params, deps);

    expect(params.logVerboseMessage).toHaveBeenCalledWith(
      "matrix: skipped startup verification request due to cooldown (retryAfterMs=321)",
    );

    vi.mocked(deps.ensureMatrixStartupVerification).mockResolvedValueOnce(
      createStartupVerificationOutcome("request-failed", { error: "boom" }),
    );

    await runMatrixStartupMaintenance(params, deps);

    expect(params.logger.debug).toHaveBeenCalledWith(
      "Matrix startup verification request failed (non-fatal)",
      { error: "boom" },
    );
  });

  it("aborts maintenance before later startup steps continue", async () => {
    const params = createParams();
    params.auth.encryption = true;
    const abortController = new AbortController();
    params.abortSignal = abortController.signal;
    vi.mocked(deps.syncMatrixOwnProfile).mockImplementation(async () => {
      abortController.abort();
      return createProfileSyncResult();
    });

    await expect(runMatrixStartupMaintenance(params, deps)).rejects.toMatchObject({
      message: "Matrix startup aborted",
      name: "AbortError",
    });
    expect(deps.ensureMatrixStartupVerification).not.toHaveBeenCalled();
    expect(deps.maybeRestoreLegacyMatrixBackup).not.toHaveBeenCalled();
  });
});
