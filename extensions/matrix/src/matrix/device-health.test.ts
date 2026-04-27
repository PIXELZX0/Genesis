import { describe, expect, it } from "vitest";
import { isGenesisManagedMatrixDevice, summarizeMatrixDeviceHealth } from "./device-health.js";

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
});
