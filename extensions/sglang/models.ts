import type { GenesisConfig } from "genesis/plugin-sdk/config-runtime";
import { discoverOpenAICompatibleLocalModels } from "genesis/plugin-sdk/provider-setup";
import { SGLANG_DEFAULT_BASE_URL, SGLANG_PROVIDER_LABEL } from "./defaults.js";

type ModelsConfig = NonNullable<GenesisConfig["models"]>;
type ProviderConfig = NonNullable<ModelsConfig["providers"]>[string];

export async function buildSglangProvider(params?: {
  baseUrl?: string;
  apiKey?: string;
}): Promise<ProviderConfig> {
  const baseUrl = (params?.baseUrl?.trim() || SGLANG_DEFAULT_BASE_URL).replace(/\/+$/, "");
  const models = await discoverOpenAICompatibleLocalModels({
    baseUrl,
    apiKey: params?.apiKey,
    label: SGLANG_PROVIDER_LABEL,
  });
  return {
    baseUrl,
    api: "openai-completions",
    models,
  };
}
