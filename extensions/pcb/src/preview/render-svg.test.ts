import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { BoardModel } from "../model/types.js";
import { renderPreview } from "./render-svg.js";

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })));
});

function passive(refDes: string, x: number, y: number): BoardModel["footprints"][number] {
  return {
    refDes,
    footprintId: "0603",
    position: { x, y },
    rotationDeg: 0,
    side: "top",
    pads: [
      {
        id: `${refDes}-1`,
        pinNumber: "1",
        shape: "rect",
        size: { w: 0.8, h: 0.9 },
        offset: { x: -0.75, y: 0 },
        layer: "F.Cu",
      },
      {
        id: `${refDes}-2`,
        pinNumber: "2",
        shape: "rect",
        size: { w: 0.8, h: 0.9 },
        offset: { x: 0.75, y: 0 },
        layer: "F.Cu",
      },
    ],
  };
}

const board: BoardModel = {
  version: 1,
  name: "preview",
  units: "mm",
  outline: [
    { x: 0, y: 0 },
    { x: 20, y: 0 },
    { x: 20, y: 15 },
    { x: 0, y: 15 },
  ],
  layerStack: { copperLayers: ["F.Cu", "B.Cu"] },
  footprints: [passive("R1", 5, 5), passive("R2", 12, 8)],
  nets: [
    {
      name: "N1",
      pins: [
        { refDes: "R1", pin: "2" },
        { refDes: "R2", pin: "1" },
      ],
    },
  ],
  traces: [],
  vias: [],
  pours: [],
};

describe("renderPreview", () => {
  it("writes a valid SVG with a viewBox and one ratsnest line", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pcb-preview-"));
    tempDirs.push(dir);
    const result = await renderPreview({
      board,
      gerbersDir: path.join(dir, "gerbers"),
      svgPath: path.join(dir, "preview.svg"),
    });
    expect(result.airwires).toBe(1);
    const svg = await fs.readFile(result.svgPath, "utf8");
    expect(svg).toMatch(/^<svg[\s>]/);
    expect(svg).toMatch(/viewBox="[\d.\s-]+"/);
    expect(svg.trimEnd().endsWith("</svg>")).toBe(true);
    expect([...svg.matchAll(/<line /g)]).toHaveLength(1);
    expect(svg).toContain('class="ratsnest"');
  });
});
