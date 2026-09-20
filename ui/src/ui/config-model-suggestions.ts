import { buildQualifiedChatModelValue } from "./chat-model-ref.ts";
import type { ModelCatalogEntry } from "./types.ts";
import type { ConfigFieldSuggestions } from "./views/config-form.shared.ts";

// Config fields that take a single `"provider/model"` reference and must name a
// model this deployment has configured and authenticated.
const QUALIFIED_MODEL_PATHS = ["tools.advisor.model", "tools.exec.safeguard.model"] as const;

/**
 * Suggest the registered models for config fields that expect a
 * `"provider/model"` reference, so the settings form offers them as a dropdown
 * instead of a bare text box. Free text still works: models outside the catalog
 * (or a catalog that failed to load) stay editable.
 */
export function buildConfigModelSuggestions(
  catalog: readonly ModelCatalogEntry[],
): ConfigFieldSuggestions {
  const seen = new Set<string>();
  const values: string[] = [];
  for (const entry of catalog) {
    const value = buildQualifiedChatModelValue(entry.id, entry.provider);
    if (!value || seen.has(value)) {
      continue;
    }
    seen.add(value);
    values.push(value);
  }
  if (values.length === 0) {
    return {};
  }
  return Object.fromEntries(QUALIFIED_MODEL_PATHS.map((path) => [path, values]));
}
