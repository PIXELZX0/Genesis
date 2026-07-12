import { describe, expect, it } from "vitest";
import type { BoardModel } from "../model/types.js";
import { writeGerber } from "./write-gerber.js";

const board: BoardModel = {
  version: 1,
  name: "g",
  units: "mm",
  outline: [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 8 },
    { x: 0, y: 8 },
  ],
  layerStack: { copperLayers: ["F.Cu", "B.Cu"] },
  footprints: [
    {
      refDes: "R1",
      footprintId: "0603",
      position: { x: 3, y: 3 },
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
        {
          id: "R1-2",
          pinNumber: "2",
          shape: "rect",
          size: { w: 0.8, h: 0.9 },
          offset: { x: 0.75, y: 0 },
          layer: "F.Cu",
        },
      ],
    },
  ],
  nets: [],
  traces: [
    {
      id: "t1",
      net: "N1",
      layer: "F.Cu",
      widthMm: 0.25,
      points: [
        { x: 2.25, y: 3 },
        { x: 5, y: 3 },
      ],
    },
  ],
  vias: [],
  pours: [],
};

describe("writeGerber", () => {
  const gtl = writeGerber(board, "F.Cu");

  it("emits an RS-274X header and footer", () => {
    expect(gtl).toContain("%FSLAX46Y46*%");
    expect(gtl).toContain("%MOMM*%");
    expect(gtl.trimEnd().endsWith("M02*")).toBe(true);
  });

  it("defines one aperture per unique (shape,size), starting at D10", () => {
    const apertures = [...gtl.matchAll(/%ADD(\d+)/g)].map((m) => Number(m[1]));
    // rect pad aperture + trace circle aperture = 2 unique apertures.
    expect(apertures).toEqual([10, 11]);
  });

  it("flashes each copper pad exactly once", () => {
    const flashes = [...gtl.matchAll(/D03\*/g)];
    expect(flashes).toHaveLength(2);
  });

  it("draws the trace as a D02 move plus D01 segments", () => {
    expect(gtl).toContain("D02*");
    expect(gtl).toContain("D01*");
  });

  it("puts no copper flashes on an empty inner side but draws the outline on Edge.Cuts", () => {
    const gko = writeGerber(board, "Edge.Cuts");
    expect(gko).not.toContain("D03*");
    expect([...gko.matchAll(/D01\*/g)].length).toBe(4);
  });

  it("uses 4.6 integer coordinates", () => {
    // pad at absolute x = 3 - 0.75 = 2.25mm -> 2250000
    expect(gtl).toContain("X2250000");
  });
});
