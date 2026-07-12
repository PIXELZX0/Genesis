import type { Footprint, Pad, Point } from "./types.js";

export function rotatePoint(p: Point, deg: number): Point {
  const rad = (deg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return { x: p.x * cos - p.y * sin, y: p.x * sin + p.y * cos };
}

/** Absolute board-coordinate center of a pad, accounting for rotation and side mirroring. */
export function padCenter(footprint: Footprint, pad: Pad): Point {
  const offset = footprint.side === "bottom" ? { x: -pad.offset.x, y: pad.offset.y } : pad.offset;
  const rotated = rotatePoint(offset, footprint.rotationDeg);
  return { x: footprint.position.x + rotated.x, y: footprint.position.y + rotated.y };
}

export type BBox = { minX: number; minY: number; maxX: number; maxY: number };

export function pointsBBox(points: Point[]): BBox {
  const minX = Math.min(...points.map((p) => p.x));
  const minY = Math.min(...points.map((p) => p.y));
  const maxX = Math.max(...points.map((p) => p.x));
  const maxY = Math.max(...points.map((p) => p.y));
  return { minX, minY, maxX, maxY };
}

/** Footprint bounding box in local (unplaced) coordinates from pad extents. */
export function footprintLocalSize(pads: Pad[]): { w: number; h: number } {
  if (pads.length === 0) {
    return { w: 1, h: 1 };
  }
  const corners = pads.flatMap((pad) => [
    { x: pad.offset.x - pad.size.w / 2, y: pad.offset.y - pad.size.h / 2 },
    { x: pad.offset.x + pad.size.w / 2, y: pad.offset.y + pad.size.h / 2 },
  ]);
  const box = pointsBBox(corners);
  return { w: box.maxX - box.minX, h: box.maxY - box.minY };
}
