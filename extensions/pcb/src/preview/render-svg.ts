import fs from "node:fs/promises";
import pcbStackup from "pcb-stackup";
import { exportGerbers } from "../gerber/export.js";
import { boardBBox } from "../gerber/write-gerber.js";
import type { BoardModel, Point } from "../model/types.js";
import { computeRatsnest } from "../ratsnest/mst.js";

export type RenderPreviewResult = {
  svgPath: string;
  airwires: number;
  layerFiles: string[];
};

function buildRatsnestOverlay(
  board: BoardModel,
  viewBox: number[],
): { markup: string; count: number } {
  const airwires = computeRatsnest(board);
  if (airwires.length === 0 || viewBox.length < 4) {
    return { markup: "", count: airwires.length };
  }
  const [vbX, vbY, vbW, vbH] = viewBox;
  const box = boardBBox(board);
  const boxW = box.maxX - box.minX || 1;
  const boxH = box.maxY - box.minY || 1;
  const scaleX = vbW / boxW;
  const scaleY = vbH / boxH;
  // ponytail: naive linear bbox->viewBox map (Y flipped for SVG). Overlay lands
  // within a fraction of a mm of the copper; fine for a preview, not for DRC.
  const toSvg = (p: Point) => ({
    x: vbX + (p.x - box.minX) * scaleX,
    y: vbY + (box.maxY - p.y) * scaleY,
  });
  const strokeWidth = 0.12 * Math.max(scaleX, scaleY);
  const dash = 0.4 * Math.max(scaleX, scaleY);
  const lines = airwires
    .map((wire) => {
      const a = toSvg(wire.from);
      const b = toSvg(wire.to);
      return `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" />`;
    })
    .join("");
  const markup = `<g class="ratsnest" stroke="#ff3860" stroke-width="${strokeWidth}" stroke-dasharray="${dash} ${dash}" fill="none">${lines}</g>`;
  return { markup, count: airwires.length };
}

/** Export gerbers, composite them via pcb-stackup, and overlay the ratsnest. */
export async function renderPreview(params: {
  board: BoardModel;
  gerbersDir: string;
  svgPath: string;
}): Promise<RenderPreviewResult> {
  const exported = await exportGerbers(params.board, params.gerbersDir);
  const layerPaths = [...exported.layers.map((l) => l.path), exported.drill];

  const layers = await Promise.all(
    layerPaths.map(async (filename) => ({
      filename,
      gerber: await fs.readFile(filename, "utf8"),
    })),
  );

  const stackup = await pcbStackup(layers);
  const top = stackup.top;
  const overlay = buildRatsnestOverlay(params.board, top.viewBox);
  const svg = overlay.markup ? top.svg.replace(/<\/svg>\s*$/, `${overlay.markup}</svg>`) : top.svg;

  await fs.writeFile(params.svgPath, svg, "utf8");
  return { svgPath: params.svgPath, airwires: overlay.count, layerFiles: layerPaths };
}
