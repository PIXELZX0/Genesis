// Narrow plugin-sdk surface for the bundled diffs plugin.
// Keep this list additive and scoped to the bundled diffs surface.

export { definePluginEntry } from "./plugin-entry.js";
export type { GenesisConfig } from "../config/config.js";
export { resolvePreferredGenesisTmpDir } from "../infra/tmp-genesis-dir.js";
export type {
  AnyAgentTool,
  GenesisPluginApi,
  GenesisPluginConfigSchema,
  GenesisPluginToolContext,
  PluginLogger,
} from "../plugins/types.js";
