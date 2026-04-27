import type { PluginManifestRegistry } from "../plugins/manifest-registry.js";
import { detectPluginAutoEnableCandidates } from "./plugin-auto-enable.detect.js";
import {
  materializePluginAutoEnableCandidatesInternal,
  resolvePluginAutoEnableManifestRegistry,
} from "./plugin-auto-enable.shared.js";
import type {
  PluginAutoEnableCandidate,
  PluginAutoEnableResult,
} from "./plugin-auto-enable.types.js";
import type { GenesisConfig } from "./types.genesis.js";

export function materializePluginAutoEnableCandidates(params: {
  config?: GenesisConfig;
  candidates: readonly PluginAutoEnableCandidate[];
  env?: NodeJS.ProcessEnv;
  manifestRegistry?: PluginManifestRegistry;
}): PluginAutoEnableResult {
  const env = params.env ?? process.env;
  const config = params.config ?? {};
  const manifestRegistry = resolvePluginAutoEnableManifestRegistry({
    config,
    env,
    manifestRegistry: params.manifestRegistry,
  });
  return materializePluginAutoEnableCandidatesInternal({
    config,
    candidates: params.candidates,
    env,
    manifestRegistry,
  });
}

export function applyPluginAutoEnable(params: {
  config?: GenesisConfig;
  env?: NodeJS.ProcessEnv;
  manifestRegistry?: PluginManifestRegistry;
}): PluginAutoEnableResult {
  const candidates = detectPluginAutoEnableCandidates(params);
  return materializePluginAutoEnableCandidates({
    config: params.config,
    candidates,
    env: params.env,
    manifestRegistry: params.manifestRegistry,
  });
}
