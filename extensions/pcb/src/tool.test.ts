import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createTestPluginApi } from "../../../test/helpers/plugins/plugin-api.js";
import { createPcbTool } from "./tool.js";

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })));
});

async function makeTool() {
  const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "pcb-tool-"));
  tempDirs.push(workspaceDir);
  const api = createTestPluginApi({});
  const tool = createPcbTool({ api, ctx: { workspaceDir } });
  const run = (params: Record<string, unknown>) => tool.execute("call", params);
  return { tool, run, workspaceDir };
}

function details(result: { details?: unknown }): Record<string, unknown> {
  return (result.details ?? {}) as Record<string, unknown>;
}

describe("pcb tool", () => {
  it("exposes the pcb tool name and schema", async () => {
    const { tool } = await makeTool();
    expect(tool.name).toBe("pcb");
    expect(tool.parameters).toBeDefined();
  });

  it("runs a full design-to-preview sequence", async () => {
    const { run } = await makeTool();

    const created = await run({ action: "create_board", name: "demo" });
    expect(details(created).status).toBe("created");

    const imported = await run({
      action: "import_netlist",
      name: "demo",
      netlist: {
        components: [
          { refDes: "R1", footprintId: "0603", group: "a" },
          { refDes: "R2", footprintId: "0603", group: "a" },
          { refDes: "U1", footprintId: "SOIC-8", group: "b" },
        ],
        nets: [
          {
            name: "N1",
            pins: [
              { refDes: "R1", pin: "2" },
              { refDes: "U1", pin: "1" },
            ],
          },
          {
            name: "N2",
            pins: [
              { refDes: "R2", pin: "1" },
              { refDes: "U1", pin: "8" },
            ],
          },
        ],
      },
    });
    expect(details(imported).footprints).toBe(3);
    expect(details(imported).autoPlaced).toBe(true);

    const placed = await run({ action: "auto_place", name: "demo" });
    expect(details(placed).status).toBe("placed");

    const rats = await run({ action: "compute_ratsnest", name: "demo" });
    expect(details(rats).count).toBe(2);

    const trace = await run({
      action: "add_trace",
      name: "demo",
      net: "N1",
      layer: "F.Cu",
      widthMm: 0.25,
      points: [
        { x: 0, y: 0 },
        { x: 3, y: 0 },
      ],
    });
    expect(details(trace).status).toBe("added");

    const via = await run({
      action: "add_via",
      name: "demo",
      net: "N1",
      position: { x: 3, y: 0 },
      drillMm: 0.4,
      padDiaMm: 0.8,
    });
    expect(details(via).status).toBe("added");

    const exported = await run({ action: "export_gerber", name: "demo" });
    const files = details(exported).files as { ext: string }[];
    expect(files.some((f) => f.ext === "gtl")).toBe(true);
    expect(files.some((f) => f.ext === "drl")).toBe(true);

    const preview = await run({ action: "render_preview", name: "demo" });
    const svgPath = details(preview).svgPath as string;
    expect(svgPath.endsWith("preview.svg")).toBe(true);
    const svg = await fs.readFile(svgPath, "utf8");
    expect(svg).toMatch(/^<svg[\s>]/);
    expect(details(preview).instruction).toContain("canvas");
  });

  it("lists boards", async () => {
    const { run } = await makeTool();
    await run({ action: "create_board", name: "b1" });
    await run({ action: "create_board", name: "b2" });
    const list = await run({ action: "list_boards" });
    expect(details(list).boards).toEqual(expect.arrayContaining(["b1", "b2"]));
  });

  it("rejects create_board without a name", async () => {
    const { run } = await makeTool();
    await expect(run({ action: "create_board" })).rejects.toThrow("name required");
  });

  it("rejects a duplicate board", async () => {
    const { run } = await makeTool();
    await run({ action: "create_board", name: "demo" });
    await expect(run({ action: "create_board", name: "demo" })).rejects.toThrow("already exists");
  });

  it("rejects an unknown footprint", async () => {
    const { run } = await makeTool();
    await run({ action: "create_board", name: "demo" });
    await expect(
      run({ action: "add_footprint", name: "demo", refDes: "X1", footprintId: "QFN-64" }),
    ).rejects.toThrow("unknown footprintId");
  });

  it("rejects a duplicate footprint refDes", async () => {
    const { run } = await makeTool();
    await run({ action: "create_board", name: "demo" });
    await run({ action: "add_footprint", name: "demo", refDes: "R1", footprintId: "0603" });
    await expect(
      run({ action: "add_footprint", name: "demo", refDes: "R1", footprintId: "0603" }),
    ).rejects.toThrow("already exists");
  });

  it("rejects a trace with fewer than two points", async () => {
    const { run } = await makeTool();
    await run({ action: "create_board", name: "demo" });
    await expect(
      run({
        action: "add_trace",
        name: "demo",
        net: "N1",
        layer: "F.Cu",
        widthMm: 0.2,
        points: [{ x: 0, y: 0 }],
      }),
    ).rejects.toThrow("at least 2 points");
  });
});
