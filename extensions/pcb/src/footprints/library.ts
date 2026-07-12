import type { Pad } from "../model/types.js";

export const BUILTIN_FOOTPRINT_IDS = ["0603", "0805", "SOIC-8", "THT-2"] as const;
export type BuiltinFootprintId = (typeof BUILTIN_FOOTPRINT_IDS)[number];

function twoPadPassive(padW: number, padH: number, spacing: number): Pad[] {
  const dx = spacing / 2;
  return [1, 2].map((pin) => ({
    id: String(pin),
    pinNumber: String(pin),
    shape: "rect" as const,
    size: { w: padW, h: padH },
    offset: { x: pin === 1 ? -dx : dx, y: 0 },
    layer: "F.Cu" as const,
  }));
}

function soic8(): Pad[] {
  const pitch = 1.27;
  const columnDx = 2.7;
  const padW = 0.6;
  const padH = 1.55;
  const rowY = [0, 1, 2, 3].map((i) => (1.5 - i) * pitch);
  const pads: Pad[] = [];
  for (let i = 0; i < 4; i++) {
    pads.push({
      id: String(i + 1),
      pinNumber: String(i + 1),
      shape: "rect",
      size: { w: padW, h: padH },
      offset: { x: -columnDx, y: rowY[i] },
      layer: "F.Cu",
    });
  }
  // Right column, pin 5 at bottom-right, pin 8 at top-right.
  for (let i = 0; i < 4; i++) {
    pads.push({
      id: String(i + 5),
      pinNumber: String(i + 5),
      shape: "rect",
      size: { w: padW, h: padH },
      offset: { x: columnDx, y: -rowY[i] },
      layer: "F.Cu",
    });
  }
  return pads;
}

function tht2(): Pad[] {
  const dx = 2.54 / 2;
  return [1, 2].map((pin) => ({
    id: String(pin),
    pinNumber: String(pin),
    shape: "circle" as const,
    size: { w: 1.8, h: 1.8 },
    offset: { x: pin === 1 ? -dx : dx, y: 0 },
    drillMm: 0.9,
    layer: "both" as const,
  }));
}

/** Return the pad template for a built-in footprint, or undefined if unknown. */
export function footprintPads(footprintId: string): Pad[] | undefined {
  switch (footprintId) {
    case "0603":
      return twoPadPassive(0.8, 0.9, 1.5);
    case "0805":
      return twoPadPassive(1.0, 1.3, 2.0);
    case "SOIC-8":
      return soic8();
    case "THT-2":
      return tht2();
    default:
      return undefined;
  }
}
