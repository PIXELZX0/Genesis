import type { MarkdownTableMode } from "./types.base.js";
import type { GenesisConfig } from "./types.genesis.js";

export type ResolveMarkdownTableModeParams = {
  cfg?: Partial<GenesisConfig>;
  channel?: string | null;
  accountId?: string | null;
};

export type ResolveMarkdownTableMode = (
  params: ResolveMarkdownTableModeParams,
) => MarkdownTableMode;
