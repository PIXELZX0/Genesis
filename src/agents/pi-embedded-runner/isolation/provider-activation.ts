import type { GenesisConfig } from "../../../config/types.genesis.js";
import type { resolvePluginProviders } from "../../../plugins/providers.runtime.js";

type ResolvePluginProviders = typeof resolvePluginProviders;

export function activatePiIsolationProviderRuntime(params: {
  attemptProvider: string;
  modelProvider: string;
  config?: GenesisConfig;
  workspaceDir: string;
  env: NodeJS.ProcessEnv;
  resolvePluginProviders: ResolvePluginProviders;
}): string[] {
  const providerRefs = [...new Set([params.attemptProvider, params.modelProvider])].toSorted(
    (left, right) => left.localeCompare(right),
  );
  params.resolvePluginProviders({
    providerRefs,
    activate: true,
    mode: "runtime",
    config: params.config,
    workspaceDir: params.workspaceDir,
    env: params.env,
  });
  return providerRefs;
}
