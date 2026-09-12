/**
 * Shared constants for the split-config layout (`genesis.json` root plus
 * `config/<section>.json` include files). Lives in `src/config/` so the write
 * path can honour the layout without importing the doctor command module.
 */
export const SPLIT_CONFIG_DIRNAME = "config";

/**
 * Keys that stay in genesis.json after a split: restart-classified gateway
 * infra (see src/gateway/config-reload-plan.ts) plus root-file metadata.
 */
export const SPLIT_ROOT_ONLY_KEYS = new Set([
  "$schema",
  "meta",
  "gateway",
  "discovery",
  "canvasHost",
]);
