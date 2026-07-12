import fs from "node:fs/promises";
import path from "node:path";
import type { BoardModel } from "../model/types.js";
import { writeExcellon } from "./write-excellon.js";
import { writeGerber } from "./write-gerber.js";

export type ExportedLayerFile = { layerId: string; ext: string; path: string };
export type ExportResult = {
  dir: string;
  layers: ExportedLayerFile[];
  drill: string;
};

const STATIC_LAYER_EXT: Record<string, string> = {
  "F.Cu": "gtl",
  "B.Cu": "gbl",
  "F.Mask": "gts",
  "B.Mask": "gbs",
  "F.Silkscreen": "gto",
  "B.Silkscreen": "gbo",
  "Edge.Cuts": "gko",
};

/** File extension for a layer id, or undefined if the layer has no Gerber output. */
export function layerExtension(layerId: string): string | undefined {
  const staticExt = STATIC_LAYER_EXT[layerId];
  if (staticExt) {
    return staticExt;
  }
  const inner = /^In(\d+)\.Cu$/.exec(layerId);
  if (inner) {
    return `g${inner[1]}`;
  }
  return undefined;
}

/** Which layers get exported for a board: copper stack plus derived mask/silk and edge. */
export function exportLayerIds(board: BoardModel): string[] {
  const layers = new Set<string>();
  for (const copper of board.layerStack.copperLayers) {
    layers.add(copper);
  }
  if (board.layerStack.copperLayers.includes("F.Cu")) {
    layers.add("F.Mask");
    layers.add("F.Silkscreen");
  }
  if (board.layerStack.copperLayers.includes("B.Cu")) {
    layers.add("B.Mask");
    layers.add("B.Silkscreen");
  }
  layers.add("Edge.Cuts");
  return [...layers].filter((layerId) => layerExtension(layerId) !== undefined);
}

/** Write every Gerber layer plus the drill file into `<dir>/board.<ext>`. */
export async function exportGerbers(board: BoardModel, dir: string): Promise<ExportResult> {
  await fs.mkdir(dir, { recursive: true });
  const layers: ExportedLayerFile[] = [];

  for (const layerId of exportLayerIds(board)) {
    const ext = layerExtension(layerId);
    if (!ext) {
      continue;
    }
    const filePath = path.join(dir, `board.${ext}`);
    await fs.writeFile(filePath, writeGerber(board, layerId), "utf8");
    layers.push({ layerId, ext, path: filePath });
  }

  const drillPath = path.join(dir, "board.drl");
  await fs.writeFile(drillPath, writeExcellon(board), "utf8");

  return { dir, layers, drill: drillPath };
}
