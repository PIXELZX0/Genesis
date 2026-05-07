import type {
  ChannelSetupAdapter,
  GenesisConfig,
  WizardPrompter,
} from "genesis/plugin-sdk/setup-runtime";
import { singleAccountKeysToMove } from "./setup-contract.js";

export type { ChannelSetupAdapter, GenesisConfig, WizardPrompter };

type TelegramChannelSection = Record<string, unknown> & {
  accounts?: Record<string, Record<string, unknown>>;
};

export type TelegramSetupInput = {
  name?: string;
  token?: string;
  tokenFile?: string;
  useEnv?: boolean;
};

type AllowFromResolution = {
  input: string;
  resolved: boolean;
  id?: string | null;
};

export const DEFAULT_ACCOUNT_ID = "default";
const BLOCKED_ACCOUNT_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const COMMON_SINGLE_ACCOUNT_KEYS_TO_MOVE = new Set([
  "name",
  "token",
  "tokenFile",
  "botToken",
  "appToken",
  "account",
  "signalNumber",
  "authDir",
  "cliPath",
  "dbPath",
  "httpUrl",
  "httpHost",
  "httpPort",
  "webhookPath",
  "webhookUrl",
  "webhookSecret",
  "service",
  "region",
  "homeserver",
  "userId",
  "accessToken",
  "password",
  "deviceName",
  "url",
  "code",
  "dmPolicy",
  "allowFrom",
  "groupPolicy",
  "groupAllowFrom",
  "defaultTo",
]);
const TELEGRAM_SINGLE_ACCOUNT_KEYS_TO_MOVE = new Set([
  ...COMMON_SINGLE_ACCOUNT_KEYS_TO_MOVE,
  ...singleAccountKeysToMove,
]);

export function normalizeTelegramSetupString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function normalizeTelegramSetupAccountId(value: string | undefined | null): string {
  const normalized = (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+/g, "")
    .replace(/-+$/g, "")
    .slice(0, 64);
  return normalized && !BLOCKED_ACCOUNT_KEYS.has(normalized) ? normalized : DEFAULT_ACCOUNT_ID;
}

function getTelegramSection(cfg: GenesisConfig): TelegramChannelSection {
  const section = cfg.channels?.telegram;
  return section && typeof section === "object" && !Array.isArray(section) ? section : {};
}

function cloneSetupValue<T>(value: T): T {
  return value && typeof value === "object" ? structuredClone(value) : value;
}

function channelHasAccounts(cfg: GenesisConfig): boolean {
  const accounts = getTelegramSection(cfg).accounts;
  return Boolean(accounts && Object.keys(accounts).length > 0);
}

function shouldStoreNameInAccounts(params: { cfg: GenesisConfig; accountId: string }): boolean {
  return params.accountId !== DEFAULT_ACCOUNT_ID || channelHasAccounts(params.cfg);
}

function applyTelegramAccountName(params: {
  cfg: GenesisConfig;
  accountId: string;
  name?: string;
}): GenesisConfig {
  const trimmed = normalizeTelegramSetupString(params.name);
  if (!trimmed) {
    return params.cfg;
  }
  const accountId = normalizeTelegramSetupAccountId(params.accountId);
  const base = getTelegramSection(params.cfg);
  if (
    !shouldStoreNameInAccounts({ cfg: params.cfg, accountId }) &&
    accountId === DEFAULT_ACCOUNT_ID
  ) {
    return {
      ...params.cfg,
      channels: {
        ...params.cfg.channels,
        telegram: {
          ...base,
          name: trimmed,
        },
      },
    } as GenesisConfig;
  }
  const accounts = base.accounts ?? {};
  const existingAccount = accounts[accountId] ?? {};
  const baseWithoutName =
    accountId === DEFAULT_ACCOUNT_ID ? (({ name: _ignored, ...rest }) => rest)(base) : base;
  return {
    ...params.cfg,
    channels: {
      ...params.cfg.channels,
      telegram: {
        ...baseWithoutName,
        accounts: {
          ...accounts,
          [accountId]: {
            ...existingAccount,
            name: trimmed,
          },
        },
      },
    },
  } as GenesisConfig;
}

function migrateTelegramBaseNameToDefaultAccount(cfg: GenesisConfig): GenesisConfig {
  const base = getTelegramSection(cfg);
  const baseName = normalizeTelegramSetupString(base.name);
  if (!baseName) {
    return cfg;
  }
  const accounts = { ...base.accounts };
  const defaultAccount = accounts[DEFAULT_ACCOUNT_ID] ?? {};
  if (!defaultAccount.name) {
    accounts[DEFAULT_ACCOUNT_ID] = { ...defaultAccount, name: baseName };
  }
  const { name: _ignored, ...rest } = base;
  return {
    ...cfg,
    channels: {
      ...cfg.channels,
      telegram: {
        ...rest,
        accounts,
      },
    },
  } as GenesisConfig;
}

function moveTopLevelAccountConfigToDefault(base: TelegramChannelSection): TelegramChannelSection {
  const accounts = base.accounts ?? {};
  if (Object.keys(accounts).length > 0) {
    return base;
  }
  const defaultAccount: Record<string, unknown> = {};
  const nextBase: TelegramChannelSection = { ...base };
  for (const key of TELEGRAM_SINGLE_ACCOUNT_KEYS_TO_MOVE) {
    if (!(key in nextBase)) {
      continue;
    }
    defaultAccount[key] = cloneSetupValue(nextBase[key]);
    delete nextBase[key];
  }
  return Object.keys(defaultAccount).length > 0
    ? {
        ...nextBase,
        accounts: {
          [DEFAULT_ACCOUNT_ID]: defaultAccount,
        },
      }
    : base;
}

export function splitTelegramSetupEntries(raw: string): string[] {
  return raw
    .split(/[\n,;]+/g)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function addWildcardAllowFrom(allowFrom?: ReadonlyArray<string | number> | null): string[] {
  const entries = (allowFrom ?? [])
    .map(String)
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (!entries.includes("*")) {
    entries.push("*");
  }
  return [...new Set(entries)];
}

export function mergeAllowFromEntries(
  current: ReadonlyArray<string | number> | null | undefined,
  additions: ReadonlyArray<string>,
): string[] {
  return [
    ...new Set([
      ...(current ?? [])
        .map(String)
        .map((entry) => entry.trim())
        .filter(Boolean),
      ...additions.map((entry) => entry.trim()).filter(Boolean),
    ]),
  ];
}

export function patchTelegramConfigForAccount(params: {
  cfg: GenesisConfig;
  accountId: string;
  patch: Record<string, unknown>;
  ensureEnabled?: boolean;
}): GenesisConfig {
  const accountId = normalizeTelegramSetupAccountId(params.accountId);
  const ensureEnabled = params.ensureEnabled ?? true;
  const base = getTelegramSection(params.cfg);
  if (accountId === DEFAULT_ACCOUNT_ID) {
    return {
      ...params.cfg,
      channels: {
        ...params.cfg.channels,
        telegram: {
          ...base,
          ...(ensureEnabled ? { enabled: true } : {}),
          ...params.patch,
        },
      },
    } as GenesisConfig;
  }

  const promotedBase = moveTopLevelAccountConfigToDefault(base);
  const accounts = promotedBase.accounts ?? {};
  const existingAccount = accounts[accountId] ?? {};
  return {
    ...params.cfg,
    channels: {
      ...params.cfg.channels,
      telegram: {
        ...promotedBase,
        ...(ensureEnabled ? { enabled: true } : {}),
        accounts: {
          ...accounts,
          [accountId]: {
            ...existingAccount,
            ...(ensureEnabled
              ? {
                  enabled:
                    typeof existingAccount.enabled === "boolean" ? existingAccount.enabled : true,
                }
              : {}),
            ...params.patch,
          },
        },
      },
    },
  } as GenesisConfig;
}

function patchTelegramScopedAccountConfig(params: {
  cfg: GenesisConfig;
  accountId: string;
  patch: Record<string, unknown>;
}): GenesisConfig {
  const accountId = normalizeTelegramSetupAccountId(params.accountId);
  const base = getTelegramSection(params.cfg);
  if (accountId === DEFAULT_ACCOUNT_ID) {
    return {
      ...params.cfg,
      channels: {
        ...params.cfg.channels,
        telegram: {
          ...base,
          enabled: true,
          ...params.patch,
        },
      },
    } as GenesisConfig;
  }
  const accounts = base.accounts ?? {};
  const existingAccount = accounts[accountId] ?? {};
  return {
    ...params.cfg,
    channels: {
      ...params.cfg.channels,
      telegram: {
        ...base,
        enabled: true,
        accounts: {
          ...accounts,
          [accountId]: {
            ...existingAccount,
            enabled: typeof existingAccount.enabled === "boolean" ? existingAccount.enabled : true,
            ...params.patch,
          },
        },
      },
    },
  } as GenesisConfig;
}

export function setTelegramChannelEnabled(cfg: GenesisConfig, enabled: boolean): GenesisConfig {
  return {
    ...cfg,
    channels: {
      ...cfg.channels,
      telegram: {
        ...getTelegramSection(cfg),
        enabled,
      },
    },
  } as GenesisConfig;
}

export function createTelegramTokenSetupAdapter(params: {
  hasCredentials: (input: TelegramSetupInput) => boolean;
  buildPatch: (input: TelegramSetupInput) => Record<string, unknown>;
  defaultAccountOnlyEnvError: string;
  missingCredentialError: string;
}): ChannelSetupAdapter {
  return {
    resolveAccountId: ({ accountId }) => normalizeTelegramSetupAccountId(accountId),
    applyAccountName: ({ cfg, accountId, name }) =>
      applyTelegramAccountName({
        cfg,
        accountId,
        name,
      }),
    validateInput: ({ accountId, input }) => {
      if (input.useEnv && accountId !== DEFAULT_ACCOUNT_ID) {
        return params.defaultAccountOnlyEnvError;
      }
      if (!input.useEnv && !params.hasCredentials(input)) {
        return params.missingCredentialError;
      }
      return null;
    },
    applyAccountConfig: ({ cfg, accountId, input }) => {
      const resolvedAccountId = normalizeTelegramSetupAccountId(accountId);
      const namedConfig = applyTelegramAccountName({
        cfg,
        accountId: resolvedAccountId,
        name: input.name,
      });
      const preparedConfig =
        resolvedAccountId === DEFAULT_ACCOUNT_ID
          ? namedConfig
          : migrateTelegramBaseNameToDefaultAccount(namedConfig);
      return patchTelegramScopedAccountConfig({
        cfg: preparedConfig,
        accountId: resolvedAccountId,
        patch: params.buildPatch(input),
      });
    },
  };
}

export async function promptResolvedTelegramAllowFrom(params: {
  prompter: WizardPrompter;
  existing: Array<string | number>;
  message: string;
  placeholder: string;
  label: string;
  parseInputs: (value: string) => string[];
  parseId: (value: string) => string | null;
  invalidWithoutTokenNote: string;
  resolveEntries: (params: { entries: string[] }) => Promise<AllowFromResolution[]>;
}): Promise<string[]> {
  while (true) {
    const entry = await params.prompter.text({
      message: params.message,
      placeholder: params.placeholder,
      initialValue: params.existing[0] ? String(params.existing[0]) : undefined,
      validate: (value) => (normalizeTelegramSetupString(value) ? undefined : "Required"),
    });
    const parts = params.parseInputs(entry);
    const results = await params.resolveEntries({ entries: parts }).catch(() => null);
    if (!results) {
      await params.prompter.note("Failed to resolve usernames. Try again.", params.label);
      continue;
    }
    const unresolved = results.filter((res) => !res.resolved || !res.id);
    if (unresolved.length > 0) {
      await params.prompter.note(params.invalidWithoutTokenNote, params.label);
      continue;
    }
    return mergeAllowFromEntries(
      params.existing,
      results.map((res) => res.id as string),
    );
  }
}
