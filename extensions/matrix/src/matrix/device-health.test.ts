import { describe, expect, it } from "vitest";
import {
  isGenesisManagedMatrixDevice,
  MATRIX_STALE_DEVICE_AUTO_PRUNE_MIN_AGE_MS,
  selectAutoPrunableMatrixDevices,
  summarizeMatrixDeviceHealth,
} from "./device-health.js";

describe("matrix device health", () => {
  it("detects Genesis-managed device names", () => {
    expect(isGenesisManagedMatrixDevice("Genesis Gateway")).toBe(true);
    expect(isGenesisManagedMatrixDevice("Genesis Debug")).toBe(true);
    expect(isGenesisManagedMatrixDevice("Element iPhone")).toBe(false);
    expect(isGenesisManagedMatrixDevice(null)).toBe(false);
  });

  it("summarizes stale Genesis-managed devices separately from the current device", () => {
    const summary = summarizeMatrixDeviceHealth([
      {
        deviceId: "du314Zpw3A",
        displayName: "Genesis Gateway",
        current: true,
      },
      {
        deviceId: "BritdXC6iL",
        displayName: "Genesis Gateway",
        current: false,
      },
      {
        deviceId: "G6NJU9cTgs",
        displayName: "Genesis Debug",
        current: false,
      },
      {
        deviceId: "phone123",
        displayName: "Element iPhone",
        current: false,
      },
    ]);

    expect(summary.currentDeviceId).toBe("du314Zpw3A");
    expect(summary.currentGenesisDevices).toEqual([
      expect.objectContaining({ deviceId: "du314Zpw3A" }),
    ]);
    expect(summary.staleGenesisDevices).toEqual([
      expect.objectContaining({ deviceId: "BritdXC6iL" }),
      expect.objectContaining({ deviceId: "G6NJU9cTgs" }),
    ]);
  });

  it("selects only stale devices idle past the auto-prune threshold", () => {
    const now = 1_000_000_000_000;
    const oldEnough = now - MATRIX_STALE_DEVICE_AUTO_PRUNE_MIN_AGE_MS - 1;
    const tooRecent = now - MATRIX_STALE_DEVICE_AUTO_PRUNE_MIN_AGE_MS + 1;
    const prunable = selectAutoPrunableMatrixDevices(
      [
        { deviceId: "OLD1", displayName: "Genesis Gateway", current: false, lastSeenTs: oldEnough },
        {
          deviceId: "FRESH",
          displayName: "Genesis Gateway",
          current: false,
          lastSeenTs: tooRecent,
        },
        { deviceId: "NOSEEN", displayName: "Genesis Gateway", current: false, lastSeenTs: null },
        { deviceId: "UNSET", displayName: "Genesis Gateway", current: false },
      ],
      { now },
    );

    expect(prunable).toEqual([expect.objectContaining({ deviceId: "OLD1" })]);
  });
});
