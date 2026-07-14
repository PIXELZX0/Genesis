import { definePluginEntry } from "genesis/plugin-sdk/plugin-entry";
import { createOrcaIdePluginConfigSchema, resolveOrcaIdeConfig } from "./src/config.js";
import { createOrcaTerminalTool } from "./src/orca-terminal-tool.js";
import { createOrcaWorktreeTool } from "./src/orca-worktree-tool.js";
import { collectOrcaIdeSecurityAuditFindings } from "./src/security-audit.js";

export default definePluginEntry({
  id: "orca-ide",
  name: "Orca IDE",
  description: "Create and drive Orca IDE worktrees and terminals via the `orca` CLI.",
  configSchema: createOrcaIdePluginConfigSchema(),
  securityAuditCollectors: [collectOrcaIdeSecurityAuditFindings],
  register(api) {
    const config = resolveOrcaIdeConfig(api.pluginConfig);
    api.registerTool(createOrcaWorktreeTool({ config }), { optional: true });
    api.registerTool(createOrcaTerminalTool({ config }), { optional: true });
  },
});
