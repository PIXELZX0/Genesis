import path from "node:path";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import type { Api, CredentialStore, Model } from "@earendil-works/pi-ai";
import {
  ModelRegistry as PiModelRegistryClass,
  ModelRuntime,
} from "@earendil-works/pi-coding-agent";
import type { ModelRegistry as PiModelRegistry } from "@earendil-works/pi-coding-agent";
import { normalizeModelCompat } from "../plugins/provider-model-compat.js";
import {
  applyProviderResolvedModelCompatWithPlugins,
  applyProviderResolvedTransportWithPlugin,
  normalizeProviderResolvedModelWithPlugin,
} from "../plugins/provider-runtime.js";
import { isRecord } from "../utils.js";
import type { PiCredentialMap } from "./pi-auth-credentials.js";
import {
  resolvePiCredentialsForDiscovery,
  scrubLegacyStaticAuthJsonEntriesForDiscovery,
  type DiscoverAuthStorageOptions,
} from "./pi-auth-discovery.js";
import { normalizeProviderId } from "./provider-id.js";

export { PiModelRegistryClass as ModelRegistry };

type ProviderRuntimeModelLike = Model<Api> & {
  contextTokens?: number;
};

type DiscoveredProviderRuntimeModelLike = Omit<ProviderRuntimeModelLike, "api"> & {
  api?: string | null;
};

type DiscoverModelsOptions = {
  providerFilter?: string;
  allowPluginNormalization?: boolean;
  modelsPath?: string | null;
};

export type RuntimeCredentialStore = CredentialStore & {
  setRuntimeApiKey(providerId: string, apiKey: string): void;
  removeRuntimeApiKey(providerId: string): void;
  hasRuntimeApiKey(providerId: string): boolean;
  getApiKey(providerId: string): Promise<string | undefined>;
};

export function createRuntimeCredentialStore(creds: PiCredentialMap): RuntimeCredentialStore {
  const store = new InMemoryCredentialStore();
  const overrides = new Map<string, string>();
  const wrapper: RuntimeCredentialStore = {
    setRuntimeApiKey(providerId, apiKey) {
      overrides.set(providerId, apiKey);
    },
    removeRuntimeApiKey(providerId) {
      overrides.delete(providerId);
    },
    hasRuntimeApiKey(providerId) {
      return overrides.has(providerId);
    },
    async getApiKey(providerId) {
      const override = overrides.get(providerId);
      if (override !== undefined) {
        return override;
      }
      const credential = await store.read(providerId);
      if (credential && credential.type === "api_key") {
        return credential.key;
      }
      return undefined;
    },
    read(providerId) {
      const override = overrides.get(providerId);
      if (override !== undefined) {
        return Promise.resolve({ type: "api_key", key: override } as never);
      }
      return store.read(providerId);
    },
    list: () => store.list(),
    modify: (providerId, fn) => store.modify(providerId, fn),
    delete: (providerId) => store.delete(providerId),
  };
  for (const [providerId, credential] of Object.entries(creds)) {
    if (credential && (credential.type === "api_key" || credential.type === "oauth")) {
      void store.modify(providerId, async () => credential as never);
    }
  }
  return wrapper;
}

export function normalizeDiscoveredPiModel<T>(
  value: T,
  agentDir: string,
  options?: Pick<DiscoverModelsOptions, "allowPluginNormalization">,
): T {
  if (!isRecord(value)) {
    return value;
  }
  if (
    typeof value.id !== "string" ||
    typeof value.name !== "string" ||
    typeof value.provider !== "string"
  ) {
    return value;
  }
  if (options?.allowPluginNormalization === false) {
    return value;
  }
  const model = value as unknown as DiscoveredProviderRuntimeModelLike;
  const pluginNormalized =
    normalizeProviderResolvedModelWithPlugin({
      provider: model.provider,
      context: {
        provider: model.provider,
        modelId: model.id,
        model: model as unknown as ProviderRuntimeModelLike,
        agentDir,
      },
    }) ?? model;
  const compatNormalized =
    applyProviderResolvedModelCompatWithPlugins({
      provider: model.provider,
      context: {
        provider: model.provider,
        modelId: model.id,
        model: pluginNormalized as unknown as ProviderRuntimeModelLike,
        agentDir,
      },
    }) ?? pluginNormalized;
  const transportNormalized =
    applyProviderResolvedTransportWithPlugin({
      provider: model.provider,
      context: {
        provider: model.provider,
        modelId: model.id,
        model: compatNormalized as unknown as ProviderRuntimeModelLike,
        agentDir,
      },
    }) ?? compatNormalized;
  if (
    !isRecord(transportNormalized) ||
    typeof transportNormalized.id !== "string" ||
    typeof transportNormalized.name !== "string" ||
    typeof transportNormalized.provider !== "string" ||
    typeof transportNormalized.api !== "string"
  ) {
    return value;
  }
  return normalizeModelCompat(transportNormalized as Model<Api>) as T;
}

export async function createPiModelRuntime(
  authStorage: CredentialStore,
  modelsPath: string | null,
) {
  return await ModelRuntime.create({
    credentials: authStorage,
    modelsPath,
  });
}

async function instantiatePiModelRegistry(
  authStorage: CredentialStore,
  modelsPath: string | null,
): Promise<PiModelRegistry> {
  const runtime = await createPiModelRuntime(authStorage, modelsPath);
  return new PiModelRegistryClass(runtime);
}

function createGenesisModelRegistry(
  registry: PiModelRegistry,
  agentDir: string,
  options?: DiscoverModelsOptions,
): PiModelRegistry {
  const getAll = registry.getAll.bind(registry);
  const getAvailable = registry.getAvailable.bind(registry);
  const find = registry.find.bind(registry);
  const providerFilter = options?.providerFilter ? normalizeProviderId(options.providerFilter) : "";
  const matchesProviderFilter = (entry: Model<Api>) =>
    !providerFilter || normalizeProviderId(entry.provider) === providerFilter;

  registry.getAll = () =>
    getAll()
      .filter((entry: Model<Api>) => matchesProviderFilter(entry))
      .map((entry: Model<Api>) => normalizeDiscoveredPiModel(entry, agentDir, options));
  registry.getAvailable = () =>
    getAvailable()
      .filter((entry: Model<Api>) => matchesProviderFilter(entry))
      .map((entry: Model<Api>) => normalizeDiscoveredPiModel(entry, agentDir, options));
  registry.find = (provider: string, modelId: string) =>
    normalizeDiscoveredPiModel(find(provider, modelId), agentDir, options);

  return registry;
}

function createAuthStorage(_path: string, creds: PiCredentialMap): RuntimeCredentialStore {
  return createRuntimeCredentialStore(creds);
}

// Compatibility helpers for pi-coding-agent 0.50+ (discover* helpers removed).
export function discoverAuthStorage(
  agentDir: string,
  options?: DiscoverAuthStorageOptions,
): RuntimeCredentialStore {
  const credentials = resolvePiCredentialsForDiscovery(agentDir, options);
  const authPath = path.join(agentDir, "auth.json");
  if (options?.readOnly !== true) {
    scrubLegacyStaticAuthJsonEntriesForDiscovery(authPath);
  }
  return createAuthStorage(authPath, credentials);
}

export async function discoverModels(
  authStorage: CredentialStore,
  agentDir: string,
  options?: DiscoverModelsOptions,
): Promise<PiModelRegistry> {
  const registry = await instantiatePiModelRegistry(
    authStorage,
    options && "modelsPath" in options
      ? (options.modelsPath ?? null)
      : path.join(agentDir, "models.json"),
  );
  return createGenesisModelRegistry(registry, agentDir, options);
}

export {
  addEnvBackedPiCredentials,
  resolvePiCredentialsForDiscovery,
  scrubLegacyStaticAuthJsonEntriesForDiscovery,
  type DiscoverAuthStorageOptions,
} from "./pi-auth-discovery.js";
