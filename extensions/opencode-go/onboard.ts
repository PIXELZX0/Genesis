import {
  applyAgentDefaultModelPrimary,
  type GenesisConfig,
} from "genesis/plugin-sdk/provider-onboard";

export const OPENCODE_GO_DEFAULT_MODEL_REF = "opencode-go/kimi-k2.6";

export function applyOpencodeGoProviderConfig(cfg: GenesisConfig): GenesisConfig {
  return cfg;
}

export function applyOpencodeGoConfig(cfg: GenesisConfig): GenesisConfig {
  return applyAgentDefaultModelPrimary(
    applyOpencodeGoProviderConfig(cfg),
    OPENCODE_GO_DEFAULT_MODEL_REF,
  );
}
