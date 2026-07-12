import { footprintLocalSize, padCenter, pointsBBox } from "../model/geometry.js";
import type { BoardModel, Pad, Point } from "../model/types.js";

type Aperture =
  | { kind: "C"; dia: number }
  | { kind: "R"; w: number; h: number }
  | { kind: "O"; w: number; h: number };

function apertureKey(a: Aperture): string {
  return a.kind === "C" ? `C:${a.dia}` : `${a.kind}:${a.w}x${a.h}`;
}

function padAperture(pad: Pad): Aperture {
  switch (pad.shape) {
    case "circle":
      return { kind: "C", dia: pad.size.w };
    case "oval":
      return { kind: "O", w: pad.size.w, h: pad.size.h };
    default:
      return { kind: "R", w: pad.size.w, h: pad.size.h };
  }
}

function fmtNum(n: number): string {
  return n.toFixed(6).replace(/0+$/, "").replace(/\.$/, "") || "0";
}

function coord(mm: number): number {
  return Math.round(mm * 1_000_000);
}

function xy(p: Point): string {
  return `X${coord(p.x)}Y${coord(p.y)}`;
}

function layerCategory(layerId: string): "copper" | "mask" | "silk" | "edge" | "other" {
  if (layerId === "Edge.Cuts") {
    return "edge";
  }
  if (layerId.endsWith(".Mask")) {
    return "mask";
  }
  if (layerId.endsWith(".Silkscreen")) {
    return "silk";
  }
  if (layerId.endsWith(".Cu")) {
    return "copper";
  }
  return "other";
}

function padOnCopperLayer(pad: Pad, layerId: string): boolean {
  return pad.layer === layerId || pad.layer === "both";
}

function padOnMaskLayer(pad: Pad, maskLayerId: string): boolean {
  const side = maskLayerId === "F.Mask" ? "F.Cu" : "B.Cu";
  return pad.layer === side || pad.layer === "both";
}

class ApertureTable {
  private readonly order: Aperture[] = [];
  private readonly index = new Map<string, number>();

  get(aperture: Aperture): number {
    const key = apertureKey(aperture);
    const existing = this.index.get(key);
    if (existing !== undefined) {
      return existing;
    }
    const dcode = 10 + this.order.length;
    this.order.push(aperture);
    this.index.set(key, dcode);
    return dcode;
  }

  definitions(): string[] {
    return this.order.map((aperture, i) => {
      const dcode = 10 + i;
      if (aperture.kind === "C") {
        return `%ADD${dcode}C,${fmtNum(aperture.dia)}*%`;
      }
      return `%ADD${dcode}${aperture.kind},${fmtNum(aperture.w)}X${fmtNum(aperture.h)}*%`;
    });
  }
}

/** Render one board layer to an RS-274X Gerber string. Straight polylines only. */
export function writeGerber(board: BoardModel, layerId: string): string {
  const category = layerCategory(layerId);
  const apertures = new ApertureTable();
  const flashes: { dcode: number; point: Point }[] = [];
  const strokes: { dcode: number; points: Point[] }[] = [];

  if (category === "copper") {
    for (const trace of board.traces) {
      if (trace.layer !== layerId) {
        continue;
      }
      const dcode = apertures.get({ kind: "C", dia: trace.widthMm });
      strokes.push({ dcode, points: trace.points });
    }
    for (const footprint of board.footprints) {
      for (const pad of footprint.pads) {
        if (!padOnCopperLayer(pad, layerId)) {
          continue;
        }
        const dcode = apertures.get(padAperture(pad));
        flashes.push({ dcode, point: padCenter(footprint, pad) });
      }
    }
    for (const via of board.vias) {
      const dcode = apertures.get({ kind: "C", dia: via.padDiaMm });
      flashes.push({ dcode, point: via.position });
    }
  } else if (category === "mask") {
    for (const footprint of board.footprints) {
      for (const pad of footprint.pads) {
        if (!padOnMaskLayer(pad, layerId)) {
          continue;
        }
        const dcode = apertures.get(padAperture(pad));
        flashes.push({ dcode, point: padCenter(footprint, pad) });
      }
    }
  } else if (category === "silk") {
    const side = layerId === "F.Silkscreen" ? "top" : "bottom";
    const dcode = apertures.get({ kind: "C", dia: 0.15 });
    for (const footprint of board.footprints) {
      if (footprint.side !== side || footprint.pads.length === 0) {
        continue;
      }
      const size = footprintLocalSize(footprint.pads);
      const cx = footprint.position.x;
      const cy = footprint.position.y;
      const hw = size.w / 2 + 0.2;
      const hh = size.h / 2 + 0.2;
      strokes.push({
        dcode,
        points: [
          { x: cx - hw, y: cy - hh },
          { x: cx + hw, y: cy - hh },
          { x: cx + hw, y: cy + hh },
          { x: cx - hw, y: cy + hh },
          { x: cx - hw, y: cy - hh },
        ],
      });
    }
  } else if (category === "edge") {
    if (board.outline.length >= 2) {
      const dcode = apertures.get({ kind: "C", dia: 0.1 });
      const closed = [...board.outline, board.outline[0]];
      strokes.push({ dcode, points: closed });
    }
  }

  const lines: string[] = [];
  lines.push(`G04 Genesis PCB ${layerId}*`);
  lines.push("%FSLAX46Y46*%");
  lines.push("%MOMM*%");
  lines.push("%LPD*%");
  for (const def of apertures.definitions()) {
    lines.push(def);
  }
  lines.push("G01*");

  for (const stroke of strokes) {
    lines.push(`D${stroke.dcode}*`);
    lines.push(`${xy(stroke.points[0])}D02*`);
    for (let i = 1; i < stroke.points.length; i++) {
      lines.push(`${xy(stroke.points[i])}D01*`);
    }
  }
  for (const flash of flashes) {
    lines.push(`D${flash.dcode}*`);
    lines.push(`${xy(flash.point)}D03*`);
  }

  lines.push("M02*");
  return `${lines.join("\n")}\n`;
}

/** Board bounding box in mm, used by the preview to align the ratsnest overlay. */
export function boardBBox(board: BoardModel) {
  const points: Point[] = [...board.outline];
  for (const footprint of board.footprints) {
    for (const pad of footprint.pads) {
      points.push(padCenter(footprint, pad));
    }
  }
  if (points.length === 0) {
    return { minX: 0, minY: 0, maxX: 1, maxY: 1 };
  }
  return pointsBBox(points);
}
