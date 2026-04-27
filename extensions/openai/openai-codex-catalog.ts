import type { ModelProviderConfig } from "genesis/plugin-sdk/provider-model-shared";

export const OPENAI_CODEX_BASE_URL = "https://chatgpt.com/backend-api/codex";

export function buildOpenAICodexProvider(): ModelProviderConfig {
  return {
    baseUrl: OPENAI_CODEX_BASE_URL,
    api: "openai-codex-responses",
    models: [],
  };
}
