import { describe, expect, it } from "vitest";
import { gridPlace, type PlacementItem } from "./grid-placement.js";

function items(n: number, group?: string): PlacementItem[] {
  return Array.from({ length: n }, (_, i) => ({
    refDes: `C${String(i + 1).padStart(2, "0")}`,
    group,
    width: 2,
    height: 1,
  }));
}

describe("gridPlace", () => {
  it("is deterministic for the same input", () => {
    const a = gridPlace(items(5));
    const b = gridPlace(items(5));
    expect([...a.entries()]).toEqual([...b.entries()]);
  });

  it("places every component exactly once", () => {
    const placed = gridPlace(items(7));
    expect(placed.size).toBe(7);
  });

  it("packs a group into ceil(sqrt(n)) columns", () => {
    const placed = gridPlace(items(9));
    const xs = new Set([...placed.values()].map((p) => Number(p.x.toFixed(4))));
    // 9 items -> 3 columns -> 3 distinct x values.
    expect(xs.size).toBe(3);
  });

  it("lays groups left-to-right by group name", () => {
    const two: PlacementItem[] = [
      { refDes: "A1", group: "a", width: 2, height: 1 },
      { refDes: "A2", group: "a", width: 2, height: 1 },
      { refDes: "B1", group: "b", width: 2, height: 1 },
      { refDes: "B2", group: "b", width: 2, height: 1 },
    ];
    const placed = gridPlace(two);
    const groupAmax = Math.max(placed.get("A1")!.x, placed.get("A2")!.x);
    const groupBmin = Math.min(placed.get("B1")!.x, placed.get("B2")!.x);
    expect(groupBmin).toBeGreaterThan(groupAmax);
  });

  it("does not overlap cells within a group", () => {
    const placed = gridPlace(items(4));
    const points = [...placed.values()];
    for (let i = 0; i < points.length; i++) {
      for (let j = i + 1; j < points.length; j++) {
        const dx = Math.abs(points[i].x - points[j].x);
        const dy = Math.abs(points[i].y - points[j].y);
        expect(dx > 0 || dy > 0).toBe(true);
      }
    }
  });
});
