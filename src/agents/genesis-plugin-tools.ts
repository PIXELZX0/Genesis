import { selectApplicableRuntimeConfig } from "../config/config.js";
import type { GenesisConfig } from "../config/types.genesis.js";
import { resolvePluginTools } from "../plugins/tools.js";
import { getActiveSecretsRuntimeSnapshot } from "../secrets/runtime.js";
import { normalizeDeliveryContext } from "../utils/delivery-context.js";
import {
  resolveGenesisPluginToolInputs,
  type GenesisPluginToolOptions,
} from "./genesis-tools.plugin-context.js";
import { applyPluginToolDeliveryDefaults } from "./plugin-tool-delivery-defaults.js";
import type { AnyAgentTool } from "./tools/common.js";

type ResolveGenesisPluginToolsOptions = GenesisPluginToolOptions & {
  pluginToolAllowlist?: string[];
  currentChannelId?: string;
  currentThreadTs?: string;
  currentMessageId?: string | number;
  sandboxRoot?: string;
  modelHasVision?: boolean;
  modelProvider?: string;
  allowMediaInvokeCommands?: boolean;
  requesterAgentIdOverride?: string;
  requireExplicitMessageTarget?: boolean;
  disableMessageTool?: boolean;
  disablePluginTools?: boolean;
};

export function resolveGenesisPluginToolsForOptions(params: {
  options?: ResolveGenesisPluginToolsOptions;
  resolvedConfig?: GenesisConfig;
  existingToolNames?: Set<string>;
}): AnyAgentTool[] {
  if (params.options?.disablePluginTools) {
    return [];
  }

  const runtimeSnapshot = getActiveSecretsRuntimeSnapshot();
  const deliveryContext = normalizeDeliveryContext({
    channel: params.options?.agentChannel,
    to: params.options?.agentTo,
    accountId: params.options?.agentAccountId,
    threadId: params.options?.agentThreadId,
  });

  const pluginTools = resolvePluginTools({
    ...resolveGenesisPluginToolInputs({
      options: params.options,
      resolvedConfig: params.resolvedConfig,
      runtimeConfig: selectApplicableRuntimeConfig({
        inputConfig: params.resolvedConfig ?? params.options?.config,
        runtimeConfig: runtimeSnapshot?.config,
        runtimeSourceConfig: runtimeSnapshot?.sourceConfig,
      }),
    }),
    existingToolNames: params.existingToolNames ?? new Set<string>(),
    toolAllowlist: params.options?.pluginToolAllowlist,
  });

  return applyPluginToolDeliveryDefaults({
    tools: pluginTools,
    deliveryContext,
  });
}
