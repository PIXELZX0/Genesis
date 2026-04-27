import { normalizeOptionalString } from "../shared/string-coerce.js";

export const DEFAULT_PLUGIN_DISCOVERY_CACHE_MS = 1000;
export const DEFAULT_PLUGIN_MANIFEST_CACHE_MS = 1000;

export function shouldUsePluginSnapshotCache(env: NodeJS.ProcessEnv): boolean {
  if (normalizeOptionalString(env.GENESIS_DISABLE_PLUGIN_DISCOVERY_CACHE)) {
    return false;
  }
  if (normalizeOptionalString(env.GENESIS_DISABLE_PLUGIN_MANIFEST_CACHE)) {
    return false;
  }
  const discoveryCacheMs = normalizeOptionalString(env.GENESIS_PLUGIN_DISCOVERY_CACHE_MS);
  if (discoveryCacheMs === "0") {
    return false;
  }
  const manifestCacheMs = normalizeOptionalString(env.GENESIS_PLUGIN_MANIFEST_CACHE_MS);
  if (manifestCacheMs === "0") {
    return false;
  }
  return true;
}

export function resolvePluginCacheMs(rawValue: string | undefined, defaultMs: number): number {
  const raw = normalizeOptionalString(rawValue);
  if (raw === "" || raw === "0") {
    return 0;
  }
  if (!raw) {
    return defaultMs;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) {
    return defaultMs;
  }
  return Math.max(0, parsed);
}

export function resolvePluginSnapshotCacheTtlMs(env: NodeJS.ProcessEnv): number {
  const discoveryCacheMs = resolvePluginCacheMs(
    env.GENESIS_PLUGIN_DISCOVERY_CACHE_MS,
    DEFAULT_PLUGIN_DISCOVERY_CACHE_MS,
  );
  const manifestCacheMs = resolvePluginCacheMs(
    env.GENESIS_PLUGIN_MANIFEST_CACHE_MS,
    DEFAULT_PLUGIN_MANIFEST_CACHE_MS,
  );
  return Math.min(discoveryCacheMs, manifestCacheMs);
}

export function buildPluginSnapshotCacheEnvKey(env: NodeJS.ProcessEnv): string {
  return JSON.stringify({
    GENESIS_BUNDLED_PLUGINS_DIR: env.GENESIS_BUNDLED_PLUGINS_DIR ?? "",
    GENESIS_DISABLE_PLUGIN_DISCOVERY_CACHE: env.GENESIS_DISABLE_PLUGIN_DISCOVERY_CACHE ?? "",
    GENESIS_DISABLE_PLUGIN_MANIFEST_CACHE: env.GENESIS_DISABLE_PLUGIN_MANIFEST_CACHE ?? "",
    GENESIS_PLUGIN_DISCOVERY_CACHE_MS: env.GENESIS_PLUGIN_DISCOVERY_CACHE_MS ?? "",
    GENESIS_PLUGIN_MANIFEST_CACHE_MS: env.GENESIS_PLUGIN_MANIFEST_CACHE_MS ?? "",
    GENESIS_HOME: env.GENESIS_HOME ?? "",
    GENESIS_STATE_DIR: env.GENESIS_STATE_DIR ?? "",
    GENESIS_CONFIG_PATH: env.GENESIS_CONFIG_PATH ?? "",
    HOME: env.HOME ?? "",
    USERPROFILE: env.USERPROFILE ?? "",
    VITEST: env.VITEST ?? "",
  });
}
