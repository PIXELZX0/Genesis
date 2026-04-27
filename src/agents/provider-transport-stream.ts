import type { StreamFn } from "@mariozechner/pi-agent-core";
import type { Api, Model } from "@mariozechner/pi-ai";
import type { GenesisConfig } from "../config/types.genesis.js";
import { resolveProviderStreamFn } from "../plugins/provider-runtime.js";
import { createAnthropicMessagesTransportStreamFn } from "./anthropic-transport-stream.js";
import {
  createAzureOpenAIResponsesTransportStreamFn,
  createOpenAICompletionsTransportStreamFn,
  createOpenAIResponsesTransportStreamFn,
} from "./openai-transport-stream.js";
import { getModelProviderRequestTransport } from "./provider-request-config.js";

const SUPPORTED_TRANSPORT_APIS = new Set<Api>([
  "openai-responses",
  "openai-codex-responses",
  "openai-completions",
  "azure-openai-responses",
  "anthropic-messages",
  "google-generative-ai",
]);

const SIMPLE_TRANSPORT_API_ALIAS: Record<string, Api> = {
  "openai-responses": "genesis-openai-responses-transport",
  "openai-codex-responses": "genesis-openai-responses-transport",
  "openai-completions": "genesis-openai-completions-transport",
  "azure-openai-responses": "genesis-azure-openai-responses-transport",
  "anthropic-messages": "genesis-anthropic-messages-transport",
  "google-generative-ai": "genesis-google-generative-ai-transport",
};

type ProviderTransportStreamContext = {
  cfg?: GenesisConfig;
  agentDir?: string;
  workspaceDir?: string;
  env?: NodeJS.ProcessEnv;
};

function createProviderOwnedGoogleTransportStreamFn(
  model: Model<Api>,
  ctx?: ProviderTransportStreamContext,
): StreamFn | undefined {
  return (
    resolveProviderStreamFn({
      provider: model.provider,
      config: ctx?.cfg,
      workspaceDir: ctx?.workspaceDir,
      env: ctx?.env,
      context: {
        config: ctx?.cfg,
        agentDir: ctx?.agentDir,
        workspaceDir: ctx?.workspaceDir,
        provider: model.provider,
        modelId: model.id,
        model,
      },
    }) ??
    resolveProviderStreamFn({
      provider: "google",
      config: ctx?.cfg,
      workspaceDir: ctx?.workspaceDir,
      env: ctx?.env,
      context: {
        config: ctx?.cfg,
        agentDir: ctx?.agentDir,
        workspaceDir: ctx?.workspaceDir,
        provider: model.provider,
        modelId: model.id,
        model,
      },
    }) ??
    undefined
  );
}

function createSupportedTransportStreamFn(
  model: Model<Api>,
  ctx?: ProviderTransportStreamContext,
): StreamFn | undefined {
  switch (model.api) {
    case "openai-responses":
    case "openai-codex-responses":
      return createOpenAIResponsesTransportStreamFn();
    case "openai-completions":
      return createOpenAICompletionsTransportStreamFn();
    case "azure-openai-responses":
      return createAzureOpenAIResponsesTransportStreamFn();
    case "anthropic-messages":
      return createAnthropicMessagesTransportStreamFn();
    case "google-generative-ai":
      return createProviderOwnedGoogleTransportStreamFn(model, ctx);
    default:
      return undefined;
  }
}

function hasTransportOverrides(model: Model<Api>): boolean {
  const request = getModelProviderRequestTransport(model);
  return Boolean(request?.proxy || request?.tls);
}

export function isTransportAwareApiSupported(api: Api): boolean {
  return SUPPORTED_TRANSPORT_APIS.has(api);
}

export function resolveTransportAwareSimpleApi(api: Api): Api | undefined {
  return SIMPLE_TRANSPORT_API_ALIAS[api];
}

export function createTransportAwareStreamFnForModel(
  model: Model<Api>,
  ctx?: ProviderTransportStreamContext,
): StreamFn | undefined {
  if (!hasTransportOverrides(model)) {
    return undefined;
  }
  if (!isTransportAwareApiSupported(model.api)) {
    throw new Error(
      `Model-provider request.proxy/request.tls is not yet supported for api "${model.api}"`,
    );
  }
  return createSupportedTransportStreamFn(model, ctx);
}

export function createBoundaryAwareStreamFnForModel(
  model: Model<Api>,
  ctx?: ProviderTransportStreamContext,
): StreamFn | undefined {
  if (!isTransportAwareApiSupported(model.api)) {
    return undefined;
  }
  return createSupportedTransportStreamFn(model, ctx);
}

export function prepareTransportAwareSimpleModel<TApi extends Api>(
  model: Model<TApi>,
  ctx?: ProviderTransportStreamContext,
): Model<Api> {
  const streamFn = createTransportAwareStreamFnForModel(model as Model<Api>, ctx);
  const alias = resolveTransportAwareSimpleApi(model.api);
  if (!streamFn || !alias) {
    return model;
  }
  return {
    ...model,
    api: alias,
  };
}

export function buildTransportAwareSimpleStreamFn(
  model: Model<Api>,
  ctx?: ProviderTransportStreamContext,
): StreamFn | undefined {
  return createTransportAwareStreamFnForModel(model, ctx);
}
