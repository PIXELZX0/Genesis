import { padCenter } from "../model/geometry.js";
import type { BoardModel, Point } from "../model/types.js";

type Hole = { diameter: number; point: Point };

function collectHoles(board: BoardModel): Hole[] {
  const holes: Hole[] = [];
  for (const footprint of board.footprints) {
    for (const pad of footprint.pads) {
      if (pad.drillMm && pad.drillMm > 0) {
        holes.push({ diameter: pad.drillMm, point: padCenter(footprint, pad) });
      }
    }
  }
  for (const via of board.vias) {
    holes.push({ diameter: via.drillMm, point: via.position });
  }
  return holes;
}

function fmtCoord(mm: number): string {
  return mm.toFixed(3);
}

/** Render all board drill holes to a METRIC Excellon (NC drill) string. */
export function writeExcellon(board: BoardModel): string {
  const holes = collectHoles(board);
  const diameters = [...new Set(holes.map((h) => h.diameter))].toSorted((a, b) => a - b);
  const toolByDiameter = new Map<number, number>();
  diameters.forEach((dia, i) => toolByDiameter.set(dia, i + 1));

  const lines: string[] = [];
  lines.push("M48");
  lines.push("METRIC,TZ");
  for (const dia of diameters) {
    const tool = toolByDiameter.get(dia)!;
    lines.push(`T${String(tool).padStart(2, "0")}C${dia.toFixed(3)}`);
  }
  lines.push("%");
  lines.push("G90");
  lines.push("G05");

  for (const dia of diameters) {
    const tool = toolByDiameter.get(dia)!;
    lines.push(`T${String(tool).padStart(2, "0")}`);
    for (const hole of holes) {
      if (hole.diameter === dia) {
        lines.push(`X${fmtCoord(hole.point.x)}Y${fmtCoord(hole.point.y)}`);
      }
    }
  }

  lines.push("T00");
  lines.push("M30");
  return `${lines.join("\n")}\n`;
}
