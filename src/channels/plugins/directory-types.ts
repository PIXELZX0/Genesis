import type { GenesisConfig } from "../../config/types.js";

export type DirectoryConfigParams = {
  cfg: GenesisConfig;
  accountId?: string | null;
  query?: string | null;
  limit?: number | null;
};
