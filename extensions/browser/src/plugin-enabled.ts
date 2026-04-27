import type { GenesisConfig } from "genesis/plugin-sdk/browser-config-runtime";
import {
  normalizePluginsConfig,
  resolveEffectiveEnableState,
} from "genesis/plugin-sdk/browser-config-runtime";

export function isDefaultBrowserPluginEnabled(cfg: GenesisConfig): boolean {
  return resolveEffectiveEnableState({
    id: "browser",
    origin: "bundled",
    config: normalizePluginsConfig(cfg.plugins),
    rootConfig: cfg,
    enabledByDefault: true,
  }).enabled;
}
