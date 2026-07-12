import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { BoardModel } from "./model/types.js";
import {
  boardExists,
  listBoards,
  mutateBoard,
  readBoard,
  readNetlist,
  slugifyBoardName,
  writeBoard,
  writeNetlist,
} from "./workspace.js";

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })));
});

async function makeWorkspace(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pcb-ws-"));
  tempDirs.push(dir);
  return dir;
}

function board(name: string): BoardModel {
  return {
    version: 1,
    name,
    units: "mm",
    outline: [],
    layerStack: { copperLayers: ["F.Cu", "B.Cu"] },
    footprints: [],
    nets: [],
    traces: [],
    vias: [],
    pours: [],
  };
}

describe("slugifyBoardName", () => {
  it("normalizes to a filesystem-safe slug", () => {
    expect(slugifyBoardName("My Board 01")).toBe("my-board-01");
  });
  it("throws on empty input", () => {
    expect(() => slugifyBoardName("   ")).toThrow();
  });
});

describe("workspace board store", () => {
  it("writes, reads back, and lists boards", async () => {
    const ws = await makeWorkspace();
    expect(await boardExists(ws, "demo")).toBe(false);
    await writeBoard(ws, board("demo"));
    expect(await boardExists(ws, "demo")).toBe(true);
    const loaded = await readBoard(ws, "demo");
    expect(loaded.name).toBe("demo");
    expect(await listBoards(ws)).toContain("demo");
  });

  it("serializes concurrent mutations under a per-board lock", async () => {
    const ws = await makeWorkspace();
    await writeBoard(ws, board("demo"));
    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        mutateBoard(ws, "demo", (b) => ({
          ...b,
          nets: [...b.nets, { name: `N${i}`, pins: [] }],
        })),
      ),
    );
    const loaded = await readBoard(ws, "demo");
    expect(loaded.nets).toHaveLength(10);
  });

  it("round-trips a netlist", async () => {
    const ws = await makeWorkspace();
    await writeBoard(ws, board("demo"));
    await writeNetlist(ws, "demo", {
      components: [{ refDes: "R1", footprintId: "0603" }],
      nets: [{ name: "N1", pins: [{ refDes: "R1", pin: "1" }] }],
    });
    const netlist = await readNetlist(ws, "demo");
    expect(netlist?.components[0].refDes).toBe("R1");
  });

  it("returns undefined for a missing netlist", async () => {
    const ws = await makeWorkspace();
    await writeBoard(ws, board("demo"));
    expect(await readNetlist(ws, "demo")).toBeUndefined();
  });
});
