import { createPluginRuntimeStore } from "genesis/plugin-sdk/runtime-store";
import type { PluginRuntime } from "genesis/plugin-sdk/runtime-store";

const { setRuntime: setMSTeamsRuntime, getRuntime: getMSTeamsRuntime } =
  createPluginRuntimeStore<PluginRuntime>({
    pluginId: "msteams",
    errorMessage: "MSTeams runtime not initialized",
  });
export { getMSTeamsRuntime, setMSTeamsRuntime };
