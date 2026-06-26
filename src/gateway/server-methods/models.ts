import { DEFAULT_PROVIDER } from "../../agents/defaults.js";
import { resetModelCatalogCache } from "../../agents/model-catalog.js";
import { buildAllowedModelSet } from "../../agents/model-selection.js";
import {
  loadConfig,
  readConfigFileSnapshotForWrite,
  writeConfigFileWithResult,
} from "../../config/config.js";
import type { GenesisConfig } from "../../config/types.genesis.js";
import {
  MODEL_APIS,
  type ModelApi,
  type ModelDefinitionConfig,
  type ModelProviderConfig,
} from "../../config/types.models.js";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  validateModelsListParams,
} from "../protocol/index.js";
import type { GatewayRequestHandlers } from "./types.js";

const DEFAULT_CONTEXT_WINDOW = 128_000;
const DEFAULT_MAX_TOKENS = 8192;

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readPositiveInt(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return Math.floor(value);
}

function readModelApi(value: unknown): ModelApi | undefined {
  return typeof value === "string" && (MODEL_APIS as readonly string[]).includes(value)
    ? (value as ModelApi)
    : undefined;
}

function buildModelDefinition(params: {
  id: string;
  name: string;
  api?: ModelApi;
  baseUrl?: string;
  contextWindow: number;
  maxTokens: number;
  reasoning: boolean;
}): ModelDefinitionConfig {
  return {
    id: params.id,
    name: params.name,
    ...(params.api ? { api: params.api } : {}),
    ...(params.baseUrl ? { baseUrl: params.baseUrl } : {}),
    reasoning: params.reasoning,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: params.contextWindow,
    maxTokens: params.maxTokens,
    metadataSource: "models-add",
  };
}

export const modelsHandlers: GatewayRequestHandlers = {
  "models.list": async ({ params, respond, context }) => {
    if (!validateModelsListParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid models.list params: ${formatValidationErrors(validateModelsListParams.errors)}`,
        ),
      );
      return;
    }
    try {
      const catalog = await context.loadGatewayModelCatalog();
      const cfg = loadConfig();
      const { allowedCatalog } = buildAllowedModelSet({
        cfg,
        catalog,
        defaultProvider: DEFAULT_PROVIDER,
      });
      const models = allowedCatalog.length > 0 ? allowedCatalog : catalog;
      respond(true, { models }, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },
  "models.add": async ({ params, respond }) => {
    const p = params ?? {};
    const provider = readString(p.provider);
    const id = readString(p.id);
    if (!provider) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "provider is required."));
      return;
    }
    if (!id) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "id is required."));
      return;
    }
    const name = readString(p.name) || id;
    const api = readModelApi(p.api);
    const baseUrl = readString(p.baseUrl) || undefined;
    const contextWindow = readPositiveInt(p.contextWindow) ?? DEFAULT_CONTEXT_WINDOW;
    const maxTokens = readPositiveInt(p.maxTokens) ?? DEFAULT_MAX_TOKENS;
    const reasoning = p.reasoning === true;
    if (p.api !== undefined && !api) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `api must be one of: ${MODEL_APIS.join(", ")}.`),
      );
      return;
    }

    const { snapshot, writeOptions } = await readConfigFileSnapshotForWrite();
    const cfg = snapshot.config;
    const existingProviders = cfg.models?.providers ?? {};
    const existingProvider = existingProviders[provider];
    const existingModels = existingProvider?.models ?? [];
    if (existingModels.some((m) => m.id === id)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `model "${id}" already exists for provider "${provider}".`,
        ),
      );
      return;
    }

    const definition = buildModelDefinition({
      id,
      name,
      api,
      baseUrl,
      contextWindow,
      maxTokens,
      reasoning,
    });
    const nextProvider: ModelProviderConfig = {
      ...existingProvider,
      baseUrl: existingProvider?.baseUrl ?? baseUrl ?? "",
      models: [...existingModels, definition],
    };
    const nextConfig: GenesisConfig = {
      ...cfg,
      models: {
        ...cfg.models,
        providers: { ...existingProviders, [provider]: nextProvider },
      },
    };

    await writeConfigFileWithResult(nextConfig, {
      ...writeOptions,
      baseSnapshot: snapshot,
      runtimeRefreshIncludeAuthStoreRefs: false,
    });
    resetModelCatalogCache();

    respond(true, { ok: true, provider, id, name }, undefined);
  },
};
