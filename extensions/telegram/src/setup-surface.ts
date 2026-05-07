import {
  hasConfiguredSecretInput,
  normalizeSecretInputString,
} from "genesis/plugin-sdk/secret-input";
import type {
  ChannelSetupWizard,
  GenesisConfig,
  WizardPrompter,
} from "genesis/plugin-sdk/setup-runtime";
import { mergeTelegramAccountConfig, resolveTelegramAccountConfig } from "./account-config.js";
import { listTelegramAccountIds, resolveDefaultTelegramAccountId } from "./account-selection.js";
import {
  parseTelegramAllowFromId,
  TELEGRAM_TOKEN_HELP_LINES,
  TELEGRAM_USER_ID_HELP_LINES,
  telegramSetupAdapter,
} from "./setup-core.js";
import {
  DEFAULT_ACCOUNT_ID,
  normalizeTelegramSetupString,
  patchTelegramConfigForAccount,
  setTelegramChannelEnabled,
  splitTelegramSetupEntries,
} from "./setup-local.js";
import {
  buildTelegramDmAccessWarningLines,
  ensureTelegramDefaultGroupMentionGate,
  shouldShowTelegramDmAccessWarning,
  telegramSetupDmPolicy,
} from "./setup-surface.helpers.js";

const channel = "telegram" as const;
type ChannelSetupWizardCredentialValues = Partial<Record<string, string>>;

function inspectTelegramSetupCredential(params: {
  cfg: GenesisConfig;
  accountId?: string | null;
}): {
  config: Record<string, unknown> & { botToken?: unknown; tokenFile?: string };
  configured: boolean;
  token: string;
} {
  const accountId = params.accountId ?? resolveDefaultTelegramAccountId(params.cfg);
  const accountConfig = resolveTelegramAccountConfig(params.cfg, accountId);
  const merged = mergeTelegramAccountConfig(params.cfg, accountId);
  const tokenFile =
    normalizeTelegramSetupString(accountConfig?.tokenFile) ??
    normalizeTelegramSetupString(params.cfg.channels?.telegram?.tokenFile);
  const tokenValue = accountConfig?.botToken ?? params.cfg.channels?.telegram?.botToken;
  const configToken = normalizeSecretInputString(tokenValue);
  const envToken =
    accountId === DEFAULT_ACCOUNT_ID
      ? normalizeTelegramSetupString(process.env.TELEGRAM_BOT_TOKEN)
      : undefined;
  return {
    config: merged,
    configured:
      Boolean(tokenFile) ||
      hasConfiguredSecretInput(tokenValue, params.cfg.secrets?.defaults) ||
      Boolean(envToken),
    token: configToken || envToken || "",
  };
}

export const telegramSetupWizard: ChannelSetupWizard = {
  channel,
  status: {
    configuredLabel: "configured",
    unconfiguredLabel: "needs token",
    configuredHint: "recommended · configured",
    unconfiguredHint: "recommended · newcomer-friendly",
    configuredScore: 1,
    unconfiguredScore: 10,
    resolveConfigured: ({ cfg, accountId }: { cfg: GenesisConfig; accountId?: string }) =>
      (accountId ? [accountId] : listTelegramAccountIds(cfg)).some((resolvedAccountId) => {
        const account = inspectTelegramSetupCredential({ cfg, accountId: resolvedAccountId });
        return account.configured;
      }),
  },
  prepare: async ({
    cfg,
    accountId,
    credentialValues,
  }: {
    cfg: GenesisConfig;
    accountId: string;
    credentialValues: ChannelSetupWizardCredentialValues;
  }) => ({
    cfg: ensureTelegramDefaultGroupMentionGate(cfg, accountId),
    credentialValues,
  }),
  credentials: [
    {
      inputKey: "token",
      providerHint: channel,
      credentialLabel: "Telegram bot token",
      preferredEnvVar: "TELEGRAM_BOT_TOKEN",
      helpTitle: "Telegram bot token",
      helpLines: TELEGRAM_TOKEN_HELP_LINES,
      envPrompt: "TELEGRAM_BOT_TOKEN detected. Use env var?",
      keepPrompt: "Telegram token already configured. Keep it?",
      inputPrompt: "Enter Telegram bot token",
      allowEnv: ({ accountId }: { accountId: string }) => accountId === DEFAULT_ACCOUNT_ID,
      inspect: ({ cfg, accountId }: { cfg: GenesisConfig; accountId?: string | null }) => {
        const inspected = inspectTelegramSetupCredential({ cfg, accountId });
        const hasConfiguredBotToken = hasConfiguredSecretInput(inspected.config.botToken);
        const hasConfiguredValue =
          hasConfiguredBotToken || Boolean(inspected.config.tokenFile?.trim());
        return {
          accountConfigured: Boolean(inspected.token) || hasConfiguredValue,
          hasConfiguredValue,
          resolvedValue: normalizeTelegramSetupString(inspected.token),
          envValue:
            accountId === DEFAULT_ACCOUNT_ID
              ? normalizeTelegramSetupString(process.env.TELEGRAM_BOT_TOKEN)
              : undefined,
        };
      },
    },
  ],
  allowFrom: {
    helpTitle: "Telegram user id",
    helpLines: TELEGRAM_USER_ID_HELP_LINES,
    message: "Telegram allowFrom (numeric sender id)",
    placeholder: "123456789",
    invalidWithoutCredentialNote:
      "Telegram allowFrom requires numeric sender ids. DM your bot first, then copy from.id from logs or getUpdates.",
    parseInputs: splitTelegramSetupEntries,
    parseId: parseTelegramAllowFromId,
    resolveEntries: async ({ entries }: { entries: string[] }) =>
      entries.map((entry) => {
        const id = parseTelegramAllowFromId(entry);
        return { input: entry, resolved: Boolean(id), id };
      }),
    apply: async ({
      cfg,
      accountId,
      allowFrom,
    }: {
      cfg: GenesisConfig;
      accountId: string;
      allowFrom: string[];
    }) =>
      patchTelegramConfigForAccount({
        cfg,
        accountId,
        patch: { dmPolicy: "allowlist", allowFrom },
      }),
  },
  finalize: async ({
    cfg,
    accountId,
    prompter,
  }: {
    cfg: GenesisConfig;
    accountId: string;
    prompter: Pick<WizardPrompter, "note">;
  }) => {
    if (!shouldShowTelegramDmAccessWarning(cfg, accountId)) {
      return;
    }
    await prompter.note(
      buildTelegramDmAccessWarningLines(accountId).join("\n"),
      "Telegram DM access warning",
    );
  },
  dmPolicy: telegramSetupDmPolicy,
  disable: (cfg: GenesisConfig) => setTelegramChannelEnabled(cfg, false),
};

export { parseTelegramAllowFromId, telegramSetupAdapter };
