import { describe, expect, it } from "vitest";
import type { BoardModel } from "../model/types.js";
import { writeExcellon } from "./write-excellon.js";

const board: BoardModel = {
  version: 1,
  name: "d",
  units: "mm",
  outline: [],
  layerStack: { copperLayers: ["F.Cu", "B.Cu"] },
  footprints: [
    {
      refDes: "J1",
      footprintId: "THT-2",
      position: { x: 5, y: 5 },
      rotationDeg: 0,
      side: "top",
      pads: [
        {
          id: "J1-1",
          pinNumber: "1",
          shape: "circle",
          size: { w: 1.8, h: 1.8 },
          offset: { x: -1.27, y: 0 },
          drillMm: 0.9,
          layer: "both",
        },
        {
          id: "J1-2",
          pinNumber: "2",
          shape: "circle",
          size: { w: 1.8, h: 1.8 },
          offset: { x: 1.27, y: 0 },
          drillMm: 0.9,
          layer: "both",
        },
      ],
    },
  ],
  nets: [],
  traces: [],
  vias: [
    {
      id: "v1",
      net: "N1",
      position: { x: 8, y: 8 },
      drillMm: 0.4,
      padDiaMm: 0.8,
      fromLayer: "F.Cu",
      toLayer: "B.Cu",
    },
  ],
  pours: [],
};

describe("writeExcellon", () => {
  const drl = writeExcellon(board);

  it("emits the M48/METRIC header and M30 footer", () => {
    expect(drl.startsWith("M48")).toBe(true);
    expect(drl).toContain("METRIC");
    expect(drl.trimEnd().endsWith("M30")).toBe(true);
  });

  it("defines one tool per unique drill diameter", () => {
    const tools = [...drl.matchAll(/^T0\dC[\d.]+$/gm)];
    // 0.9mm (two pads) + 0.4mm (one via) = 2 unique diameters.
    expect(tools).toHaveLength(2);
    expect(drl).toContain("T01C0.400");
    expect(drl).toContain("T02C0.900");
  });

  it("writes every hole coordinate", () => {
    // two pad holes at x = 5 -/+ 1.27 and one via at 8,8
    expect(drl).toContain("X3.730Y5.000");
    expect(drl).toContain("X6.270Y5.000");
    expect(drl).toContain("X8.000Y8.000");
  });
});
