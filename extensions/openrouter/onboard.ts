import {
  applyAgentDefaultModelPrimary,
  type GenesisConfig,
} from "genesis/plugin-sdk/provider-onboard";

export const OPENROUTER_DEFAULT_MODEL_REF = "openrouter/auto";

export function applyOpenrouterProviderConfig(cfg: GenesisConfig): GenesisConfig {
  const models = { ...cfg.agents?.defaults?.models };
  models[OPENROUTER_DEFAULT_MODEL_REF] = {
    ...models[OPENROUTER_DEFAULT_MODEL_REF],
    alias: models[OPENROUTER_DEFAULT_MODEL_REF]?.alias ?? "OpenRouter",
  };

  return {
    ...cfg,
    agents: {
      ...cfg.agents,
      defaults: {
        ...cfg.agents?.defaults,
        models,
      },
    },
  };
}

export function applyOpenrouterConfig(cfg: GenesisConfig): GenesisConfig {
  return applyAgentDefaultModelPrimary(
    applyOpenrouterProviderConfig(cfg),
    OPENROUTER_DEFAULT_MODEL_REF,
  );
}
