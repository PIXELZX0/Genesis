import { createProviderApiKeyAuthMethod } from "genesis/plugin-sdk/provider-auth-api-key";
import {
  buildProviderReplayFamilyHooks,
  DEFAULT_CONTEXT_TOKENS,
} from "genesis/plugin-sdk/provider-model-shared";
import {
  buildProviderStreamFamilyHooks,
  createOpenRouterSystemCacheWrapper,
  createOpenRouterWrapper,
  getOpenRouterModelCapabilities,
  isProxyReasoningUnsupported,
  loadOpenRouterModelCapabilities,
} from "genesis/plugin-sdk/provider-stream-family";
import { openrouterMediaUnderstandingProvider } from "./media-understanding-provider.js";
import { applyOpenrouterConfig, OPENROUTER_DEFAULT_MODEL_REF } from "./onboard.js";
import { buildOpenrouterProvider } from "./provider-catalog.js";
import { buildOpenRouterSpeechProvider } from "./speech-provider.js";

export {
  applyOpenrouterConfig,
  buildOpenrouterProvider,
  buildOpenRouterSpeechProvider,
  buildProviderReplayFamilyHooks,
  buildProviderStreamFamilyHooks,
  createOpenRouterSystemCacheWrapper,
  createOpenRouterWrapper,
  createProviderApiKeyAuthMethod,
  DEFAULT_CONTEXT_TOKENS,
  getOpenRouterModelCapabilities,
  isProxyReasoningUnsupported,
  loadOpenRouterModelCapabilities,
  OPENROUTER_DEFAULT_MODEL_REF,
  openrouterMediaUnderstandingProvider,
};
