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
