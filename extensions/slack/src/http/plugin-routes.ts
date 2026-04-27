import { DEFAULT_ACCOUNT_ID } from "genesis/plugin-sdk/account-id";
import type { GenesisPluginApi } from "genesis/plugin-sdk/channel-plugin-common";
import { listSlackAccountIds, mergeSlackAccountConfig } from "../accounts.js";
import { normalizeSlackWebhookPath } from "./paths.js";
import { handleSlackHttpRequest } from "./registry.js";

export function registerSlackPluginHttpRoutes(api: GenesisPluginApi): void {
  const accountIds = new Set<string>([DEFAULT_ACCOUNT_ID, ...listSlackAccountIds(api.config)]);
  const registeredPaths = new Set<string>();
  for (const accountId of accountIds) {
    // Route registration must remain config-only and should not resolve tokens.
    const accountConfig = mergeSlackAccountConfig(api.config, accountId);
    registeredPaths.add(normalizeSlackWebhookPath(accountConfig.webhookPath));
  }
  if (registeredPaths.size === 0) {
    registeredPaths.add(normalizeSlackWebhookPath());
  }
  for (const path of registeredPaths) {
    api.registerHttpRoute({
      path,
      auth: "plugin",
      handler: async (req, res) => await handleSlackHttpRequest(req, res),
    });
  }
}
