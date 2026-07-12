import { describe, expect, it } from "vitest";
import { BoardModelSchema } from "./schema.js";

const validBoard = {
  version: 1,
  name: "demo",
  units: "mm",
  outline: [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
  ],
  layerStack: { copperLayers: ["F.Cu", "B.Cu"] },
  footprints: [
    {
      refDes: "R1",
      footprintId: "0603",
      position: { x: 1, y: 2 },
      rotationDeg: 0,
      side: "top",
      pads: [
        {
          id: "R1-1",
          pinNumber: "1",
          shape: "rect",
          size: { w: 0.8, h: 0.9 },
          offset: { x: -0.75, y: 0 },
          layer: "F.Cu",
        },
      ],
    },
  ],
  nets: [{ name: "N1", pins: [{ refDes: "R1", pin: "1" }] }],
  traces: [],
  vias: [],
  pours: [],
};

describe("BoardModelSchema", () => {
  it("accepts a valid board", () => {
    expect(() => BoardModelSchema.parse(validBoard)).not.toThrow();
  });

  it("rejects a wrong version literal", () => {
    expect(() => BoardModelSchema.parse({ ...validBoard, version: 2 })).toThrow();
  });

  it("rejects a non-positive pad size", () => {
    const bad = structuredClone(validBoard);
    bad.footprints[0].pads[0].size.w = 0;
    expect(() => BoardModelSchema.parse(bad)).toThrow();
  });

  it("rejects a trace with fewer than two points", () => {
    const bad = structuredClone(validBoard) as Record<string, unknown>;
    bad.traces = [{ id: "t1", net: "N1", layer: "F.Cu", widthMm: 0.2, points: [{ x: 0, y: 0 }] }];
    expect(() => BoardModelSchema.parse(bad)).toThrow();
  });
});
