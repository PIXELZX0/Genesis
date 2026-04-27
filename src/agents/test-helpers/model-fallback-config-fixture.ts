import type { GenesisConfig } from "../../config/types.genesis.js";

export function makeModelFallbackCfg(overrides: Partial<GenesisConfig> = {}): GenesisConfig {
  return {
    agents: {
      defaults: {
        model: {
          primary: "openai/gpt-4.1-mini",
          fallbacks: ["anthropic/claude-haiku-3-5"],
        },
      },
    },
    ...overrides,
  } as GenesisConfig;
}
