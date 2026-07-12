import { describe, expect, it } from "vitest";
import type { BoardModel, Pad } from "../model/types.js";
import { computeRatsnest } from "./mst.js";

function pad(pinNumber: string, x: number): Pad {
  return {
    id: `p${pinNumber}`,
    pinNumber,
    shape: "rect",
    size: { w: 0.8, h: 0.9 },
    offset: { x, y: 0 },
    layer: "F.Cu",
  };
}

function boardWith(pins: number, options: { trace?: boolean } = {}): BoardModel {
  const footprints = Array.from({ length: pins }, (_, i) => ({
    refDes: `R${i + 1}`,
    footprintId: "0603",
    position: { x: i * 5, y: 0 },
    rotationDeg: 0,
    side: "top" as const,
    pads: [pad("1", 0)],
  }));
  const netPins = footprints.map((fp) => ({ refDes: fp.refDes, pin: "1" }));
  const board: BoardModel = {
    version: 1,
    name: "rats",
    units: "mm",
    outline: [],
    layerStack: { copperLayers: ["F.Cu"] },
    footprints,
    nets: [{ name: "N1", pins: netPins }],
    traces: [],
    vias: [],
    pours: [],
  };
  if (options.trace && pins >= 2) {
    // Route between R1 pin1 (0,0) and R2 pin1 (5,0).
    board.traces.push({
      id: "t1",
      net: "N1",
      layer: "F.Cu",
      widthMm: 0.2,
      points: [
        { x: 0, y: 0 },
        { x: 5, y: 0 },
      ],
    });
  }
  return board;
}

describe("computeRatsnest", () => {
  it("produces k-1 airwires for k unrouted pads on a net", () => {
    expect(computeRatsnest(boardWith(4))).toHaveLength(3);
    expect(computeRatsnest(boardWith(2))).toHaveLength(1);
  });

  it("produces no airwires for a single-pad net", () => {
    expect(computeRatsnest(boardWith(1))).toHaveLength(0);
  });

  it("reduces airwire count when a trace pre-connects pads", () => {
    const unrouted = computeRatsnest(boardWith(3));
    const routed = computeRatsnest(boardWith(3, { trace: true }));
    expect(routed.length).toBe(unrouted.length - 1);
  });

  it("returns airwires tagged with their net", () => {
    const airwires = computeRatsnest(boardWith(2));
    expect(airwires[0].net).toBe("N1");
  });
});
