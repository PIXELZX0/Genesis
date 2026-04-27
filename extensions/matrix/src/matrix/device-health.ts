export type MatrixManagedDeviceInfo = {
  deviceId: string;
  displayName: string | null;
  current: boolean;
};

export type MatrixDeviceHealthSummary = {
  currentDeviceId: string | null;
  staleGenesisDevices: MatrixManagedDeviceInfo[];
  currentGenesisDevices: MatrixManagedDeviceInfo[];
};

const GENESIS_DEVICE_NAME_PREFIX = "Genesis ";

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
