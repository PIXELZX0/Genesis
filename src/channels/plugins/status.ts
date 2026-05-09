import type { GenesisConfig } from "../../config/types.genesis.js";
import { normalizeOptionalString } from "../../shared/string-coerce.js";
import { projectSafeChannelAccountSnapshotFields } from "../account-snapshot-fields.js";
import { inspectReadOnlyChannelAccount } from "../read-only-account-inspect.js";
import type { ChannelPlugin } from "./types.plugin.js";
import type { ChannelAccountSnapshot } from "./types.public.js";

// Channel docking: status snapshots flow through plugin.status hooks here.
async function buildSnapshotFromAccount<ResolvedAccount>(params: {
  plugin: ChannelPlugin<ResolvedAccount>;
  cfg: GenesisConfig;
  accountId: string;
  account: ResolvedAccount;
  runtime?: ChannelAccountSnapshot;
  probe?: unknown;
  audit?: unknown;
  enabled?: boolean;
  configured?: boolean;
}): Promise<ChannelAccountSnapshot> {
  if (params.plugin.status?.buildAccountSnapshot) {
    const snapshot = await params.plugin.status.buildAccountSnapshot({
      account: params.account,
      cfg: params.cfg,
      runtime: params.runtime,
      probe: params.probe,
      audit: params.audit,
    });
    return normalizeOptionalString(snapshot.accountId)
      ? snapshot
      : {
          ...snapshot,
          accountId: params.accountId,
        };
  }
  const enabled =
    params.enabled ??
    (params.plugin.config.isEnabled
      ? params.plugin.config.isEnabled(params.account, params.cfg)
      : params.account && typeof params.account === "object"
        ? (params.account as { enabled?: boolean }).enabled
        : undefined);
  const configured =
    params.account && typeof params.account === "object" && "configured" in params.account
      ? (params.account as { configured?: boolean }).configured
      : params.configured !== undefined
        ? params.configured
        : params.plugin.config.isConfigured
          ? await params.plugin.config.isConfigured(params.account, params.cfg)
          : undefined;
  return {
    accountId: params.accountId,
    enabled,
    configured,
    ...projectSafeChannelAccountSnapshotFields(params.account),
  };
}

async function inspectChannelAccount<ResolvedAccount>(params: {
  plugin: ChannelPlugin<ResolvedAccount>;
  cfg: GenesisConfig;
  accountId: string;
}): Promise<ResolvedAccount | null> {
  return (params.plugin.config.inspectAccount?.(params.cfg, params.accountId) ??
    (await inspectReadOnlyChannelAccount({
      channelId: params.plugin.id,
      cfg: params.cfg,
      accountId: params.accountId,
    }))) as ResolvedAccount | null;
}

export async function buildReadOnlySourceChannelAccountSnapshot<ResolvedAccount>(params: {
  plugin: ChannelPlugin<ResolvedAccount>;
  cfg: GenesisConfig;
  accountId: string;
  runtime?: ChannelAccountSnapshot;
  probe?: unknown;
  audit?: unknown;
}): Promise<ChannelAccountSnapshot | null> {
  const inspectedAccount = await inspectChannelAccount(params);
  if (!inspectedAccount) {
    return null;
  }
  return await buildSnapshotFromAccount({
    ...params,
    account: inspectedAccount as ResolvedAccount,
  });
}

export async function buildChannelAccountSnapshot<ResolvedAccount>(params: {
  plugin: ChannelPlugin<ResolvedAccount>;
  cfg: GenesisConfig;
  accountId: string;
  runtime?: ChannelAccountSnapshot;
  probe?: unknown;
  audit?: unknown;
  fallbackAccount?: ResolvedAccount;
  fallbackEnabled?: boolean;
  fallbackConfigured?: boolean;
}): Promise<ChannelAccountSnapshot> {
  const inspectedAccount = await inspectChannelAccount(params);
  const account =
    inspectedAccount ??
    params.fallbackAccount ??
    params.plugin.config.resolveAccount(params.cfg, params.accountId);
  const fallbackFields = inspectedAccount
    ? {}
    : {
        ...(typeof params.fallbackEnabled === "boolean" ? { enabled: params.fallbackEnabled } : {}),
        ...(typeof params.fallbackConfigured === "boolean"
          ? { configured: params.fallbackConfigured }
          : {}),
      };
  return await buildSnapshotFromAccount({
    ...params,
    account,
    ...fallbackFields,
  });
}
