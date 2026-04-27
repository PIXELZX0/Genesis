import type { GenesisConfig } from "genesis/plugin-sdk/config-runtime";
import { inspectDiscordAccount } from "./src/account-inspect.js";

export function inspectDiscordReadOnlyAccount(cfg: GenesisConfig, accountId?: string | null) {
  return inspectDiscordAccount({ cfg, accountId });
}
