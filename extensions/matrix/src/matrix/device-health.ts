export type MatrixManagedDeviceInfo = {
  deviceId: string;
  displayName: string | null;
  current: boolean;
  lastSeenTs?: number | null;
};

export type MatrixDeviceHealthSummary = {
  currentDeviceId: string | null;
  staleGenesisDevices: MatrixManagedDeviceInfo[];
  currentGenesisDevices: MatrixManagedDeviceInfo[];
};

const GENESIS_DEVICE_NAME_PREFIX = "Genesis ";

/**
 * Minimum idle age before a stale Genesis device is safe to auto-prune. Guards
 * multi-gateway setups: a second live gateway on the same account refreshes its
 * last-seen timestamp and stays under this threshold.
 */
export const MATRIX_STALE_DEVICE_AUTO_PRUNE_MIN_AGE_MS = 72 * 60 * 60 * 1000;

export function isGenesisManagedMatrixDevice(displayName: string | null | undefined): boolean {
  return displayName?.startsWith(GENESIS_DEVICE_NAME_PREFIX) === true;
}

export function summarizeMatrixDeviceHealth(
  devices: MatrixManagedDeviceInfo[],
): MatrixDeviceHealthSummary {
  const currentDeviceId = devices.find((device) => device.current)?.deviceId ?? null;
  const genesisDevices = devices.filter((device) =>
    isGenesisManagedMatrixDevice(device.displayName),
  );
  return {
    currentDeviceId,
    staleGenesisDevices: genesisDevices.filter((device) => !device.current),
    currentGenesisDevices: genesisDevices.filter((device) => device.current),
  };
}

/**
 * Stale Genesis devices old enough to delete without operator confirmation.
 * Devices with no last-seen timestamp are excluded: a just-created device can
 * report null before the homeserver records activity.
 */
export function selectAutoPrunableMatrixDevices(
  staleGenesisDevices: MatrixManagedDeviceInfo[],
  opts: { now?: number; minAgeMs?: number } = {},
): MatrixManagedDeviceInfo[] {
  const now = opts.now ?? Date.now();
  const minAgeMs = opts.minAgeMs ?? MATRIX_STALE_DEVICE_AUTO_PRUNE_MIN_AGE_MS;
  return staleGenesisDevices.filter(
    (device) => typeof device.lastSeenTs === "number" && now - device.lastSeenTs > minAgeMs,
  );
}
