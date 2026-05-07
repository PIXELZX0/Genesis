import type { GenesisConfig } from "../config/types.genesis.js";
import { resolveProviderBuiltInModelSuppression } from "../plugins/provider-runtime.js";
import { normalizeLowercaseStringOrEmpty } from "../shared/string-coerce.js";
import { normalizeProviderId } from "./provider-id.js";

function resolveBuiltInModelSuppression(params: {
  provider?: string | null;
  id?: string | null;
  baseUrl?: string | null;
  config?: GenesisConfig;
  installBundledRuntimeDeps?: boolean;
}) {
  const provider = normalizeProviderId(params.provider ?? "");
  const modelId = normalizeLowercaseStringOrEmpty(params.id);
  if (!provider || !modelId) {
    return undefined;
  }
  return resolveProviderBuiltInModelSuppression({
    ...(params.config ? { config: params.config } : {}),
    env: process.env,
    installBundledRuntimeDeps: params.installBundledRuntimeDeps,
    context: {
      ...(params.config ? { config: params.config } : {}),
      env: process.env,
      provider,
      modelId,
      ...(params.baseUrl ? { baseUrl: params.baseUrl } : {}),
    },
  });
}

export function shouldSuppressBuiltInModel(params: {
  provider?: string | null;
  id?: string | null;
  baseUrl?: string | null;
  config?: GenesisConfig;
  installBundledRuntimeDeps?: boolean;
}) {
  return resolveBuiltInModelSuppression(params)?.suppress ?? false;
}

export function buildSuppressedBuiltInModelError(params: {
  provider?: string | null;
  id?: string | null;
  baseUrl?: string | null;
  config?: GenesisConfig;
  installBundledRuntimeDeps?: boolean;
}): string | undefined {
  return resolveBuiltInModelSuppression(params)?.errorMessage;
}
