export type { ChannelPlugin, GenesisPluginApi, PluginRuntime } from "genesis/plugin-sdk/core";
export type { GenesisConfig } from "genesis/plugin-sdk/config-runtime";
export type {
  GenesisPluginService,
  GenesisPluginServiceContext,
  PluginLogger,
} from "genesis/plugin-sdk/core";
export type { ResolvedQQBotAccount, QQBotAccountConfig } from "./src/types.js";
export { getQQBotRuntime, setQQBotRuntime } from "./src/bridge/runtime.js";
