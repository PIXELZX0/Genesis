import type { PluginRuntime } from "genesis/plugin-sdk/core";
import { createPluginRuntimeStore } from "genesis/plugin-sdk/runtime-store";
import type { GatewayPluginRuntime } from "../engine/gateway/types.js";

const { setRuntime: _setRuntime, getRuntime: getQQBotRuntime } =
  createPluginRuntimeStore<PluginRuntime>({
    pluginId: "qqbot",
    errorMessage: "QQBot runtime not initialized",
  });

function setQQBotRuntime(runtime: PluginRuntime): void {
  _setRuntime(runtime);
}

export { getQQBotRuntime, setQQBotRuntime };

/** Type-narrowed getter for engine/ modules that need GatewayPluginRuntime. */
export function getQQBotRuntimeForEngine(): GatewayPluginRuntime {
  return getQQBotRuntime() as unknown as GatewayPluginRuntime;
}
