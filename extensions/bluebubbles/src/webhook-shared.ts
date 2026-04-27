import { normalizeOptionalString } from "genesis/plugin-sdk/text-runtime";
import { normalizeWebhookPath } from "genesis/plugin-sdk/webhook-path";
import type { BlueBubblesAccountConfig } from "./types.js";

export { normalizeWebhookPath };

export const DEFAULT_WEBHOOK_PATH = "/bluebubbles-webhook";

export function resolveWebhookPathFromConfig(config?: BlueBubblesAccountConfig): string {
  const raw = normalizeOptionalString(config?.webhookPath);
  if (raw) {
    return normalizeWebhookPath(raw);
  }
  return DEFAULT_WEBHOOK_PATH;
}
