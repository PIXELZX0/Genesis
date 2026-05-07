import type { ChannelPlugin } from "genesis/plugin-sdk/channel-core";
import { getChatChannelMeta } from "genesis/plugin-sdk/channel-plugin-common";
import type { TelegramAccountConfig } from "genesis/plugin-sdk/config-runtime";
import { mergeTelegramAccountConfig } from "./account-config.js";
import { listTelegramAccountIds, resolveDefaultTelegramAccountId } from "./account-selection.js";
import type { TelegramProbe } from "./probe.js";
import { namedAccountPromotionKeys, singleAccountKeysToMove } from "./setup-contract.js";
import { telegramSetupAdapter } from "./setup-core.js";
import {
  type GenesisConfig,
  normalizeTelegramSetupAccountId,
  normalizeTelegramSetupString,
} from "./setup-local.js";
import { telegramSetupWizard } from "./setup-surface.js";

type TelegramSetupAccount = {
  accountId: string;
  enabled: boolean;
  name?: string;
  config: TelegramAccountConfig;
};

function resolveTelegramSetupAccount(
  cfg: GenesisConfig,
  accountId?: string | null,
): TelegramSetupAccount {
  const resolvedAccountId = normalizeTelegramSetupAccountId(
    accountId ?? resolveDefaultTelegramAccountId(cfg),
  );
  const config = mergeTelegramAccountConfig(cfg, resolvedAccountId);
  return {
    accountId: resolvedAccountId,
    enabled: cfg.channels?.telegram?.enabled !== false && config.enabled !== false,
    name: normalizeTelegramSetupString(config.name),
    config,
  };
}

export const telegramSetupPlugin: ChannelPlugin<TelegramSetupAccount, TelegramProbe> = {
  id: "telegram",
  meta: {
    ...getChatChannelMeta("telegram"),
    quickstartAllowFrom: true,
  },
  capabilities: {
    chatTypes: ["direct", "group", "channel", "thread"],
    reactions: true,
    threads: true,
    media: true,
    polls: true,
    nativeCommands: true,
    blockStreaming: true,
  },
  setupWizard: telegramSetupWizard,
  config: {
    listAccountIds: listTelegramAccountIds,
    resolveAccount: resolveTelegramSetupAccount,
    defaultAccountId: resolveDefaultTelegramAccountId,
    isEnabled: (account) => account.enabled,
    resolveAllowFrom: ({ cfg, accountId }) =>
      resolveTelegramSetupAccount(cfg, accountId).config.allowFrom,
    resolveDefaultTo: ({ cfg, accountId }) => {
      const defaultTo = resolveTelegramSetupAccount(cfg, accountId).config.defaultTo;
      return defaultTo == null ? undefined : String(defaultTo);
    },
  },
  setup: {
    ...telegramSetupAdapter,
    namedAccountPromotionKeys,
    singleAccountKeysToMove,
  },
};
