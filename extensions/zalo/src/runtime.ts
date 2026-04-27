import { createPluginRuntimeStore } from "genesis/plugin-sdk/runtime-store";
import type { PluginRuntime } from "./runtime-support.js";

const { setRuntime: setZaloRuntime, getRuntime: getZaloRuntime } =
  createPluginRuntimeStore<PluginRuntime>({
    pluginId: "zalo",
    errorMessage: "Zalo runtime not initialized",
  });
export { getZaloRuntime, setZaloRuntime };
