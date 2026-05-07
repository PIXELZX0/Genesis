import type { Api, Model } from "@mariozechner/pi-ai";
import type { ModelRegistry } from "@mariozechner/pi-coding-agent";
import type { GenesisConfig } from "../../config/types.genesis.js";
import { loadModelRegistry } from "./list.registry.js";
import { discoverAuthStorage, discoverModels, resolveGenesisAgentDir } from "./list.runtime.js";
import type { ConfiguredEntry } from "./list.types.js";
import { modelKey } from "./shared.js";

export async function loadListModelRegistry(
  cfg: GenesisConfig,
  opts?: { providerFilter?: string },
) {
  const loaded = await loadModelRegistry(cfg, opts);
  return {
    ...loaded,
    discoveredKeys: new Set(loaded.models.map((model) => modelKey(model.provider, model.id))),
  };
}

function findConfiguredRegistryModel(params: {
  registry: ModelRegistry;
  entry: ConfiguredEntry;
}): Model<Api> | undefined {
  const model = params.registry.find(params.entry.ref.provider, params.entry.ref.model);
  if (!model) {
    return undefined;
  }
  return model;
}

export function loadConfiguredListModelRegistry(
  cfg: GenesisConfig,
  entries: ConfiguredEntry[],
  opts?: { providerFilter?: string },
) {
  void cfg;
  const agentDir = resolveGenesisAgentDir();
  const authStorage = discoverAuthStorage(agentDir, {
    readOnly: true,
    resolveSyntheticAuth: false,
  });
  const registry = discoverModels(authStorage, agentDir, {
    providerFilter: opts?.providerFilter,
    allowPluginNormalization: false,
  });
  const discoveredKeys = new Set<string>();
  const availableKeys = new Set<string>();

  for (const entry of entries) {
    const model = findConfiguredRegistryModel({ registry, entry });
    if (!model) {
      continue;
    }
    const key = modelKey(model.provider, model.id);
    discoveredKeys.add(key);
    if (registry.hasConfiguredAuth(model)) {
      availableKeys.add(key);
    }
  }

  return {
    registry,
    discoveredKeys,
    availableKeys,
  };
}
