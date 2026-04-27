import { resolveAgentModelFallbackValues } from "../config/model-input.js";
import type { GenesisConfig } from "../config/types.genesis.js";
import type { ModelCatalogEntry } from "./model-catalog.types.js";
import type { ModelRef } from "./model-selection-normalize.js";
import {
  buildAllowedModelSetWithFallbacks,
  buildModelAliasIndex,
  getModelRefStatusWithFallbackModels,
  resolveAllowedModelRefFromAliasIndex,
  type ModelRefStatus,
} from "./model-selection-shared.js";

export {
  buildConfiguredAllowlistKeys,
  buildConfiguredModelCatalog,
  buildModelAliasIndex,
  inferUniqueProviderFromConfiguredModels,
  normalizeModelSelection,
  resolveConfiguredModelRef,
  resolveHooksGmailModel,
  resolveModelRefFromString,
} from "./model-selection-shared.js";
export type { ModelAliasIndex, ModelRefStatus } from "./model-selection-shared.js";

function resolveDefaultFallbackModels(cfg: GenesisConfig): string[] {
  return resolveAgentModelFallbackValues(cfg.agents?.defaults?.model);
}

export function buildAllowedModelSet(params: {
  cfg: GenesisConfig;
  catalog: ModelCatalogEntry[];
  defaultProvider: string;
  defaultModel?: string;
}): {
  allowAny: boolean;
  allowedCatalog: ModelCatalogEntry[];
  allowedKeys: Set<string>;
} {
  const { cfg, catalog, defaultProvider, defaultModel } = params;
  return buildAllowedModelSetWithFallbacks({
    cfg,
    catalog,
    defaultProvider,
    defaultModel,
    fallbackModels: resolveDefaultFallbackModels(cfg),
  });
}

export function getModelRefStatus(params: {
  cfg: GenesisConfig;
  catalog: ModelCatalogEntry[];
  ref: ModelRef;
  defaultProvider: string;
  defaultModel?: string;
}): ModelRefStatus {
  const { cfg, catalog, ref, defaultProvider, defaultModel } = params;
  return getModelRefStatusWithFallbackModels({
    cfg,
    catalog,
    ref,
    defaultProvider,
    defaultModel,
    fallbackModels: resolveDefaultFallbackModels(cfg),
  });
}

export function resolveAllowedModelRef(params: {
  cfg: GenesisConfig;
  catalog: ModelCatalogEntry[];
  raw: string;
  defaultProvider: string;
  defaultModel?: string;
}):
  | { ref: ModelRef; key: string }
  | {
      error: string;
    } {
  const aliasIndex = buildModelAliasIndex({
    cfg: params.cfg,
    defaultProvider: params.defaultProvider,
  });
  return resolveAllowedModelRefFromAliasIndex({
    cfg: params.cfg,
    raw: params.raw,
    defaultProvider: params.defaultProvider,
    aliasIndex,
    getStatus: (ref) =>
      getModelRefStatus({
        cfg: params.cfg,
        catalog: params.catalog,
        ref,
        defaultProvider: params.defaultProvider,
        defaultModel: params.defaultModel,
      }),
  });
}
