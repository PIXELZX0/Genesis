import type { PluginRuntime } from "genesis/plugin-sdk/core";
import { createPluginRuntimeStore } from "genesis/plugin-sdk/runtime-store";
import type { GatewayPluginRuntime } from "../engine/gateway/types.js";
import { setGenesisVersion } from "../engine/messaging/sender.js";

const { setRuntime: _setRuntime, getRuntime: getQQBotRuntime } =
  createPluginRuntimeStore<PluginRuntime>({
    pluginId: "qqbot",
    errorMessage: "QQBot runtime not initialized",
  });

/** Set the QQBot runtime and inject the framework version into the User-Agent. */
function setQQBotRuntime(runtime: PluginRuntime): void {
  _setRuntime(runtime);
  // Inject the framework version into the User-Agent string (same as standalone).
  setGenesisVersion(runtime.version);
}

export { getQQBotRuntime, setQQBotRuntime };

/** Type-narrowed getter for engine/ modules that need GatewayPluginRuntime. */
export function getQQBotRuntimeForEngine(): GatewayPluginRuntime {
  return getQQBotRuntime() as unknown as GatewayPluginRuntime;
}
