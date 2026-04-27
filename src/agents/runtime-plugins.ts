import type { GenesisConfig } from "../config/types.genesis.js";
import { resolveRuntimePluginRegistry } from "../plugins/loader.js";
import { getActivePluginRuntimeSubagentMode } from "../plugins/runtime.js";
import { resolveUserPath } from "../utils.js";

export function ensureRuntimePluginsLoaded(params: {
  config?: GenesisConfig;
  workspaceDir?: string | null;
  allowGatewaySubagentBinding?: boolean;
}): void {
  const workspaceDir =
    typeof params.workspaceDir === "string" && params.workspaceDir.trim()
      ? resolveUserPath(params.workspaceDir)
      : undefined;
  const allowGatewaySubagentBinding =
    params.allowGatewaySubagentBinding === true ||
    getActivePluginRuntimeSubagentMode() === "gateway-bindable";
  const loadOptions = {
    config: params.config,
    workspaceDir,
    runtimeOptions: allowGatewaySubagentBinding
      ? {
          allowGatewaySubagentBinding: true,
        }
      : undefined,
  };
  resolveRuntimePluginRegistry(loadOptions);
}
