import { describe, expect, it } from "vitest";
import { BUILTIN_FOOTPRINT_IDS, footprintPads } from "./library.js";

describe("footprintPads", () => {
  it("returns two pads for passives", () => {
    expect(footprintPads("0603")).toHaveLength(2);
    expect(footprintPads("0805")).toHaveLength(2);
  });

  it("returns eight pads for SOIC-8 with unique pin numbers", () => {
    const pads = footprintPads("SOIC-8");
    expect(pads).toHaveLength(8);
    expect(new Set(pads?.map((p) => p.pinNumber)).size).toBe(8);
  });

  it("returns through-hole pads with a drill for THT-2", () => {
    const pads = footprintPads("THT-2");
    expect(pads).toHaveLength(2);
    expect(pads?.every((p) => p.drillMm && p.layer === "both")).toBe(true);
  });

  it("returns undefined for an unknown footprint", () => {
    expect(footprintPads("QFN-64")).toBeUndefined();
  });

  it("exposes every built-in id", () => {
    for (const id of BUILTIN_FOOTPRINT_IDS) {
      expect(footprintPads(id)).toBeDefined();
    }
  });
});
