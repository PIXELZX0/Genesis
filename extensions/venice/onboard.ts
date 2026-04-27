import {
  createModelCatalogPresetAppliers,
  type GenesisConfig,
} from "genesis/plugin-sdk/provider-onboard";
import {
  buildVeniceModelDefinition,
  VENICE_BASE_URL,
  VENICE_DEFAULT_MODEL_REF,
  VENICE_MODEL_CATALOG,
} from "./api.js";

export { VENICE_DEFAULT_MODEL_REF };

const venicePresetAppliers = createModelCatalogPresetAppliers({
  primaryModelRef: VENICE_DEFAULT_MODEL_REF,
  resolveParams: (_cfg: GenesisConfig) => ({
    providerId: "venice",
    api: "openai-completions",
    baseUrl: VENICE_BASE_URL,
    catalogModels: VENICE_MODEL_CATALOG.map(buildVeniceModelDefinition),
    aliases: [{ modelRef: VENICE_DEFAULT_MODEL_REF, alias: "Kimi K2.5" }],
  }),
});

export function applyVeniceProviderConfig(cfg: GenesisConfig): GenesisConfig {
  return venicePresetAppliers.applyProviderConfig(cfg);
}

export function applyVeniceConfig(cfg: GenesisConfig): GenesisConfig {
  return venicePresetAppliers.applyConfig(cfg);
}
