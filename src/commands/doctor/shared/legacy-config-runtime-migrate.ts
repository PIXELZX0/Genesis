import type { GenesisConfig } from "../../../config/types.genesis.js";
import { normalizeBaseCompatibilityConfigValues } from "./legacy-config-compatibility-base.js";

export function normalizeRuntimeCompatibilityConfigValues(cfg: GenesisConfig): {
  config: GenesisConfig;
  changes: string[];
} {
  const changes: string[] = [];
  const next = normalizeBaseCompatibilityConfigValues(cfg, changes);
  return { config: next, changes };
}
