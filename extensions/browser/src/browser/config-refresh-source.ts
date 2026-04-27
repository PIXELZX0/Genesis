import { createConfigIO, getRuntimeConfigSnapshot, type GenesisConfig } from "../config/config.js";

export function loadBrowserConfigForRuntimeRefresh(): GenesisConfig {
  return getRuntimeConfigSnapshot() ?? createConfigIO().loadConfig();
}
