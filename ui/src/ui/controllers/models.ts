import type { GatewayBrowserClient } from "../gateway.ts";
import type { ModelCatalogEntry } from "../types.ts";

/**
 * Fetch the model catalog from the gateway.
 *
 * Accepts a {@link GatewayBrowserClient} (matching the existing ui/ controller
 * convention).  Returns an array of {@link ModelCatalogEntry}; on failure the
 * caller receives an empty array rather than throwing.
 */
export async function loadModels(client: GatewayBrowserClient): Promise<ModelCatalogEntry[]> {
  try {
    const result = await client.request<{ models: ModelCatalogEntry[] }>("models.list", {});
    return result?.models ?? [];
  } catch {
    return [];
  }
}

export interface AddModelParams {
  provider: string;
  id: string;
  name?: string;
  contextWindow?: number;
  reasoning?: boolean;
  baseUrl?: string;
}

/**
 * Register a custom model definition under a provider (gateway `models.add`).
 * The new model is persisted to config and surfaces in the catalog on refresh.
 */
export async function addModel(
  client: GatewayBrowserClient,
  params: AddModelParams,
): Promise<void> {
  await client.request("models.add", {
    provider: params.provider,
    id: params.id,
    ...(params.name ? { name: params.name } : {}),
    ...(typeof params.contextWindow === "number" ? { contextWindow: params.contextWindow } : {}),
    ...(params.reasoning ? { reasoning: true } : {}),
    ...(params.baseUrl ? { baseUrl: params.baseUrl } : {}),
  });
}

export interface AddProviderParams {
  provider: string;
  apiKey: string;
  displayName?: string;
}

function randomProfileSuffix(): string {
  return Math.random().toString(36).slice(2, 8);
}

/**
 * Add an API-key auth profile for a provider (gateway `models.authProfileAdd`).
 * Storing the credential is what makes the provider usable from the catalog.
 */
export async function addProvider(
  client: GatewayBrowserClient,
  params: AddProviderParams,
): Promise<void> {
  await client.request("models.authProfileAdd", {
    profileId: `${params.provider}-${randomProfileSuffix()}`,
    provider: params.provider,
    mode: "api_key",
    value: params.apiKey,
    ...(params.displayName ? { displayName: params.displayName } : {}),
  });
}
