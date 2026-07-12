import type { Point } from "../model/types.js";

export type PlacementItem = {
  refDes: string;
  group?: string;
  width: number;
  height: number;
};

export type PlacementOptions = {
  gutter?: number;
  groupGutter?: number;
  originX?: number;
  originY?: number;
};

const DEFAULT_GUTTER = 2;
const DEFAULT_GROUP_GUTTER = 5;

/**
 * Deterministic group-by-grid placement. Components are grouped by `group`,
 * groups and refDes are sorted, each group is packed into a ceil(sqrt(n))-column
 * row-major grid, and groups are laid left-to-right with gutter spacing.
 * Returns each component's center point.
 */
export function gridPlace(
  items: PlacementItem[],
  options: PlacementOptions = {},
): Map<string, Point> {
  const gutter = options.gutter ?? DEFAULT_GUTTER;
  const groupGutter = options.groupGutter ?? DEFAULT_GROUP_GUTTER;
  const originX = options.originX ?? 0;
  const originY = options.originY ?? 0;

  const groups = new Map<string, PlacementItem[]>();
  for (const item of items) {
    const key = item.group ?? "default";
    const bucket = groups.get(key);
    if (bucket) {
      bucket.push(item);
    } else {
      groups.set(key, [item]);
    }
  }

  const result = new Map<string, Point>();
  let cursorX = originX;

  for (const groupName of [...groups.keys()].toSorted()) {
    const members = groups.get(groupName)!.toSorted((a, b) => a.refDes.localeCompare(b.refDes));
    const cols = Math.max(1, Math.ceil(Math.sqrt(members.length)));
    const cellW = Math.max(...members.map((m) => m.width)) + gutter;
    const cellH = Math.max(...members.map((m) => m.height)) + gutter;

    members.forEach((item, index) => {
      const col = index % cols;
      const row = Math.floor(index / cols);
      result.set(item.refDes, {
        x: cursorX + col * cellW + cellW / 2,
        y: originY - row * cellH - cellH / 2,
      });
    });

    const groupWidth = cols * cellW;
    cursorX += groupWidth + groupGutter;
  }

  return result;
}
