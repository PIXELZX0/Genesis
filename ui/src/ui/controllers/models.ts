import type { GatewayBrowserClient } from "../gateway.ts";
import type { ModelCatalogEntry } from "../types.ts";

const modelLoads = new WeakMap<GatewayBrowserClient, Promise<ModelCatalogEntry[]>>();

/**
 * Fetch the model catalog from the gateway.
 *
 * Accepts a {@link GatewayBrowserClient} (matching the existing ui/ controller
 * convention).  Returns an array of {@link ModelCatalogEntry}; on failure the
 * caller receives an empty array rather than throwing.
 */
export function loadModels(
  client: GatewayBrowserClient,
  opts?: { refresh?: boolean },
): Promise<ModelCatalogEntry[]> {
  if (!opts?.refresh) {
    const pending = modelLoads.get(client);
    if (pending) {
      return pending;
    }
  }

  let response: Promise<{ models: ModelCatalogEntry[] }>;
  try {
    response = client.request<{ models: ModelCatalogEntry[] }>("models.list", {});
  } catch (err) {
    response = Promise.reject(err);
  }
  let request: Promise<ModelCatalogEntry[]>;
  request = Promise.resolve(response)
    .then((result) => result?.models ?? [])
    .catch(() => [])
    .finally(() => {
      if (modelLoads.get(client) === request) {
        modelLoads.delete(client);
      }
    });
  modelLoads.set(client, request);
  return request;
}
