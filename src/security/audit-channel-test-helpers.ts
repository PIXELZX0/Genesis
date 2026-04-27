import type { ChannelPlugin } from "../channels/plugins/types.js";
import type { GenesisConfig } from "../config/config.js";

export function stubAuditChannelPlugin(params: {
  id: string;
  label: string;
  commands: ChannelPlugin["commands"];
  collectAuditFindings: NonNullable<ChannelPlugin["security"]>["collectAuditFindings"];
  resolveAccount: (cfg: GenesisConfig, accountId: string | null | undefined) => unknown;
  inspectAccount?: (cfg: GenesisConfig, accountId: string | null | undefined) => unknown;
  isConfigured?: (account: unknown, cfg: GenesisConfig) => boolean;
}): ChannelPlugin {
  return {
    id: params.id,
    meta: {
      id: params.id,
      label: params.label,
      selectionLabel: params.label,
      docsPath: "/docs/testing",
      blurb: "test stub",
    },
    capabilities: {
      chatTypes: ["direct", "group"],
    },
    commands: params.commands,
    security: {
      collectAuditFindings: params.collectAuditFindings,
    },
    config: {
      listAccountIds: () => ["default"],
      inspectAccount:
        params.inspectAccount ??
        ((cfg, accountId) => {
          const resolvedAccountId =
            typeof accountId === "string" && accountId ? accountId : "default";
          const account = params.resolveAccount(cfg, resolvedAccountId) as
            | { config?: Record<string, unknown> }
            | undefined;
          return {
            accountId: resolvedAccountId,
            enabled: true,
            configured: true,
            config: account?.config ?? {},
          };
        }),
      resolveAccount: (cfg, accountId) => params.resolveAccount(cfg, accountId),
      isEnabled: () => true,
      isConfigured: (account, cfg) => params.isConfigured?.(account, cfg) ?? true,
    },
  };
}
