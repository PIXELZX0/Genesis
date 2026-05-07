import type { ChannelSetupDmPolicy, GenesisConfig } from "genesis/plugin-sdk/setup-runtime";
import { formatCliCommand, formatDocsLink } from "genesis/plugin-sdk/setup-tools";
import { mergeTelegramAccountConfig } from "./account-config.js";
import { resolveDefaultTelegramAccountId } from "./account-selection.js";
import { promptTelegramAllowFromForAccount } from "./setup-core.js";
import {
  addWildcardAllowFrom,
  DEFAULT_ACCOUNT_ID,
  normalizeTelegramSetupString,
  patchTelegramConfigForAccount,
} from "./setup-local.js";

const channel = "telegram" as const;

export function ensureTelegramDefaultGroupMentionGate(
  cfg: GenesisConfig,
  accountId: string,
): GenesisConfig {
  const resolved = mergeTelegramAccountConfig(cfg, accountId);
  const wildcardGroup = resolved.groups?.["*"];
  if (wildcardGroup?.requireMention !== undefined) {
    return cfg;
  }
  return patchTelegramConfigForAccount({
    cfg,
    accountId,
    patch: {
      groups: {
        ...resolved.groups,
        "*": {
          ...wildcardGroup,
          requireMention: true,
        },
      },
    },
  });
}

export function shouldShowTelegramDmAccessWarning(cfg: GenesisConfig, accountId: string): boolean {
  const merged = mergeTelegramAccountConfig(cfg, accountId);
  const policy = merged.dmPolicy ?? "pairing";
  const hasAllowFrom =
    Array.isArray(merged.allowFrom) &&
    merged.allowFrom.some((entry) => normalizeTelegramSetupString(String(entry)));
  return policy === "pairing" && !hasAllowFrom;
}

export function buildTelegramDmAccessWarningLines(accountId: string): string[] {
  const configBase =
    accountId === DEFAULT_ACCOUNT_ID
      ? "channels.telegram"
      : `channels.telegram.accounts.${accountId}`;
  return [
    "Your bot is using DM policy: pairing.",
    "Any Telegram user who discovers the bot can send pairing requests.",
    "For private use, configure an allowlist with your Telegram user id:",
    "  " + formatCliCommand(`genesis config set ${configBase}.dmPolicy "allowlist"`),
    "  " + formatCliCommand(`genesis config set ${configBase}.allowFrom '["YOUR_USER_ID"]'`),
    `Docs: ${formatDocsLink("/channels/pairing", "channels/pairing")}`,
  ];
}

export const telegramSetupDmPolicy: ChannelSetupDmPolicy = {
  label: "Telegram",
  channel,
  policyKey: "channels.telegram.dmPolicy",
  allowFromKey: "channels.telegram.allowFrom",
  resolveConfigKeys: (cfg: GenesisConfig, accountId?: string) =>
    (accountId ?? resolveDefaultTelegramAccountId(cfg)) !== DEFAULT_ACCOUNT_ID
      ? {
          policyKey: `channels.telegram.accounts.${accountId ?? resolveDefaultTelegramAccountId(cfg)}.dmPolicy`,
          allowFromKey: `channels.telegram.accounts.${accountId ?? resolveDefaultTelegramAccountId(cfg)}.allowFrom`,
        }
      : {
          policyKey: "channels.telegram.dmPolicy",
          allowFromKey: "channels.telegram.allowFrom",
        },
  getCurrent: (cfg: GenesisConfig, accountId?: string) =>
    mergeTelegramAccountConfig(cfg, accountId ?? resolveDefaultTelegramAccountId(cfg)).dmPolicy ??
    "pairing",
  setPolicy: (cfg, policy, accountId) => {
    const resolvedAccountId = accountId ?? resolveDefaultTelegramAccountId(cfg);
    const merged = mergeTelegramAccountConfig(cfg, resolvedAccountId);
    const patch = {
      dmPolicy: policy,
      ...(policy === "open" ? { allowFrom: addWildcardAllowFrom(merged.allowFrom) } : {}),
    };
    return accountId == null && resolvedAccountId !== DEFAULT_ACCOUNT_ID
      ? patchTelegramConfigForAccount({
          cfg,
          accountId: resolvedAccountId,
          patch,
          ensureEnabled: false,
        })
      : patchTelegramConfigForAccount({
          cfg,
          accountId: resolvedAccountId,
          patch,
        });
  },
  promptAllowFrom: promptTelegramAllowFromForAccount,
};
