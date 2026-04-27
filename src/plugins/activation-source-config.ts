import {
  getRuntimeConfigSnapshot,
  getRuntimeConfigSourceSnapshot,
} from "../config/runtime-snapshot.js";
import type { GenesisConfig } from "../config/types.genesis.js";

export function resolvePluginActivationSourceConfig(params: {
  config?: GenesisConfig;
  activationSourceConfig?: GenesisConfig;
}): GenesisConfig {
  if (params.activationSourceConfig !== undefined) {
    return params.activationSourceConfig;
  }
  const sourceSnapshot = getRuntimeConfigSourceSnapshot();
  if (sourceSnapshot && params.config === getRuntimeConfigSnapshot()) {
    return sourceSnapshot;
  }
  return params.config ?? {};
}
