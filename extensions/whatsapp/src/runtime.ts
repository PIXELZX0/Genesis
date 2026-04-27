import type { PluginRuntime } from "genesis/plugin-sdk/core";
import { createPluginRuntimeStore } from "genesis/plugin-sdk/runtime-store";

const { setRuntime: setWhatsAppRuntime, getRuntime: getWhatsAppRuntime } =
  createPluginRuntimeStore<PluginRuntime>({
    pluginId: "whatsapp",
    errorMessage: "WhatsApp runtime not initialized",
  });
export { getWhatsAppRuntime, setWhatsAppRuntime };
