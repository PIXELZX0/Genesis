import {
  getChannelPluginCatalogEntry,
  listChannelPluginCatalogEntries,
  type ChannelPluginCatalogEntry,
} from "../../channels/plugins/catalog.js";
import { applyPluginAutoEnable } from "../../config/plugin-auto-enable.js";
import type { GenesisConfig } from "../../config/types.genesis.js";
import { normalizePluginsConfig, resolveEnableState } from "../../plugins/config-state.js";

function resolveEffectiveTrustConfig(cfg: GenesisConfig, env?: NodeJS.ProcessEnv): GenesisConfig {
  return applyPluginAutoEnable({
    config: cfg,
    env: env ?? process.env,
  }).config;
}

function isTrustedWorkspaceChannelCatalogEntry(
  entry: ChannelPluginCatalogEntry | undefined,
  cfg: GenesisConfig,
  env?: NodeJS.ProcessEnv,
): boolean {
  if (entry?.origin !== "workspace") {
    return true;
  }
  if (!entry.pluginId) {
    return false;
  }
  const effectiveConfig = resolveEffectiveTrustConfig(cfg, env);
  return resolveEnableState(
    entry.pluginId,
    "workspace",
    normalizePluginsConfig(effectiveConfig.plugins),
  ).enabled;
}

export function getTrustedChannelPluginCatalogEntry(
  channelId: string,
  params: {
    cfg: GenesisConfig;
    workspaceDir?: string;
    env?: NodeJS.ProcessEnv;
  },
): ChannelPluginCatalogEntry | undefined {
  const candidate = getChannelPluginCatalogEntry(channelId, {
    workspaceDir: params.workspaceDir,
  });
  if (isTrustedWorkspaceChannelCatalogEntry(candidate, params.cfg, params.env)) {
    return candidate;
  }
  return getChannelPluginCatalogEntry(channelId, {
    workspaceDir: params.workspaceDir,
    excludeWorkspace: true,
  });
}

function listChannelPluginCatalogEntriesWithTrustedFallback(
  params: {
    cfg: GenesisConfig;
    workspaceDir?: string;
    env?: NodeJS.ProcessEnv;
  },
  onMissingFallback: (entry: ChannelPluginCatalogEntry) => ChannelPluginCatalogEntry[],
): ChannelPluginCatalogEntry[] {
  const unfiltered = listChannelPluginCatalogEntries({
    workspaceDir: params.workspaceDir,
  });
  const fallbackById = new Map(
    listChannelPluginCatalogEntries({
      workspaceDir: params.workspaceDir,
      excludeWorkspace: true,
    }).map((entry) => [entry.id, entry]),
  );
  return unfiltered.flatMap((entry) => {
    if (isTrustedWorkspaceChannelCatalogEntry(entry, params.cfg, params.env)) {
      return [entry];
    }
    const fallback = fallbackById.get(entry.id);
    return fallback ? [fallback] : onMissingFallback(entry);
  });
}

export function listTrustedChannelPluginCatalogEntries(params: {
  cfg: GenesisConfig;
  workspaceDir?: string;
  env?: NodeJS.ProcessEnv;
}): ChannelPluginCatalogEntry[] {
  return listChannelPluginCatalogEntriesWithTrustedFallback(params, () => []);
}

export function listSetupDiscoveryChannelPluginCatalogEntries(params: {
  cfg: GenesisConfig;
  workspaceDir?: string;
  env?: NodeJS.ProcessEnv;
}): ChannelPluginCatalogEntry[] {
  return listChannelPluginCatalogEntriesWithTrustedFallback(params, (entry) => [entry]);
}
