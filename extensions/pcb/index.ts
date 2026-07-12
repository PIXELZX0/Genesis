import { definePluginEntry, type GenesisPluginToolContext } from "./api.js";
import { createPcbTool } from "./src/tool.js";

export default definePluginEntry({
  id: "pcb",
  name: "PCB Design",
  description:
    "Create and edit PCB designs, compute ratsnest, and export Gerber/Excellon files with a live SVG preview for Canvas.",
  register(api) {
    api.registerTool((ctx: GenesisPluginToolContext) => createPcbTool({ api, ctx }), {
      name: "pcb",
    });
  },
});

export { createPcbTool } from "./src/tool.js";
export { BoardModelSchema } from "./src/model/schema.js";
export { NetlistSchema } from "./src/netlist/schema.js";
export { gridPlace } from "./src/placement/grid-placement.js";
export { computeRatsnest } from "./src/ratsnest/mst.js";
export { writeGerber } from "./src/gerber/write-gerber.js";
export { writeExcellon } from "./src/gerber/write-excellon.js";
export { exportGerbers } from "./src/gerber/export.js";
