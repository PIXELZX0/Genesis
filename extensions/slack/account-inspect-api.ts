import type { GenesisConfig } from "genesis/plugin-sdk/config-runtime";
import { inspectSlackAccount } from "./src/account-inspect.js";

export function inspectSlackReadOnlyAccount(cfg: GenesisConfig, accountId?: string | null) {
  return inspectSlackAccount({ cfg, accountId });
}
