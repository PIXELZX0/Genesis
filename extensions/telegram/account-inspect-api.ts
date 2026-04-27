import type { GenesisConfig } from "./runtime-api.js";
import { inspectTelegramAccount } from "./src/account-inspect.js";

export function inspectTelegramReadOnlyAccount(cfg: GenesisConfig, accountId?: string | null) {
  return inspectTelegramAccount({ cfg, accountId });
}
