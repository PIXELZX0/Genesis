import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { BoardModel } from "../model/types.js";
import { exportGerbers, exportLayerIds, layerExtension } from "./export.js";

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })));
});

const board: BoardModel = {
  version: 1,
  name: "e",
  units: "mm",
  outline: [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 6 },
  ],
  layerStack: { copperLayers: ["F.Cu", "In1.Cu", "B.Cu"] },
  footprints: [],
  nets: [],
  traces: [],
  vias: [],
  pours: [],
};

describe("layerExtension", () => {
  it("maps known layers", () => {
    expect(layerExtension("F.Cu")).toBe("gtl");
    expect(layerExtension("B.Cu")).toBe("gbl");
    expect(layerExtension("In1.Cu")).toBe("g1");
    expect(layerExtension("Edge.Cuts")).toBe("gko");
  });

  it("returns undefined for unknown layers", () => {
    expect(layerExtension("F.Paste")).toBeUndefined();
  });
});

describe("exportLayerIds", () => {
  it("includes copper stack, derived mask/silk, and edge cuts", () => {
    const ids = exportLayerIds(board);
    expect(ids).toEqual(
      expect.arrayContaining([
        "F.Cu",
        "In1.Cu",
        "B.Cu",
        "F.Mask",
        "B.Mask",
        "F.Silkscreen",
        "B.Silkscreen",
        "Edge.Cuts",
      ]),
    );
  });
});

describe("exportGerbers", () => {
  it("writes a file per layer plus the drill file", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pcb-export-"));
    tempDirs.push(dir);
    const result = await exportGerbers(board, dir);
    for (const layer of result.layers) {
      const stat = await fs.stat(layer.path);
      expect(stat.size).toBeGreaterThan(0);
    }
    expect(path.basename(result.drill)).toBe("board.drl");
    const files = await fs.readdir(dir);
    expect(files).toContain("board.gtl");
    expect(files).toContain("board.g1");
    expect(files).toContain("board.drl");
  });
});
