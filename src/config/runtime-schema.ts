import { resolveAgentWorkspaceDir, resolveDefaultAgentId } from "../agents/agent-scope.js";
import { loadPluginManifestRegistry } from "../plugins/manifest-registry.js";
import {
  collectChannelSchemaMetadata,
  collectPluginSchemaMetadata,
} from "./channel-config-metadata.js";
import { loadConfig, readConfigFileSnapshot, registerConfigWriteListener } from "./config.js";
import type { GenesisConfig } from "./config.js";
import { buildConfigSchema, type ConfigSchemaResponse } from "./schema.js";

function loadManifestRegistry(config: GenesisConfig, env?: NodeJS.ProcessEnv) {
  const workspaceDir = resolveAgentWorkspaceDir(config, resolveDefaultAgentId(config));
  return loadPluginManifestRegistry({
    config,
    cache: false,
    env,
    workspaceDir,
  });
}

let schemaByRuntimeConfig = new WeakMap<GenesisConfig, ConfigSchemaResponse>();
let cacheInvalidatorRegistered = false;

export function clearRuntimeConfigSchemaCache(): void {
  schemaByRuntimeConfig = new WeakMap<GenesisConfig, ConfigSchemaResponse>();
}

function ensureConfigSchemaCacheInvalidator(): void {
  if (cacheInvalidatorRegistered) {
    return;
  }
  cacheInvalidatorRegistered = true;
  registerConfigWriteListener(() => clearRuntimeConfigSchemaCache());
}

export function loadGatewayRuntimeConfigSchema(): ConfigSchemaResponse {
  ensureConfigSchemaCacheInvalidator();
  const config = loadConfig();
  const cached = schemaByRuntimeConfig.get(config);
  if (cached) {
    return cached;
  }
  const registry = loadManifestRegistry(config);
  const schema = buildConfigSchema({
    plugins: collectPluginSchemaMetadata(registry),
    channels: collectChannelSchemaMetadata(registry),
  });
  schemaByRuntimeConfig.set(config, schema);
  return schema;
}

export async function readBestEffortRuntimeConfigSchema(): Promise<ConfigSchemaResponse> {
  const snapshot = await readConfigFileSnapshot();
  const config = snapshot.valid ? snapshot.config : { plugins: { enabled: true } };
  const registry = loadManifestRegistry(config);
  return buildConfigSchema({
    plugins: snapshot.valid ? collectPluginSchemaMetadata(registry) : [],
    channels: collectChannelSchemaMetadata(registry),
  });
}
