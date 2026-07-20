import {
  DEFAULT_ACCOUNT_ID,
  normalizeAccountId,
  normalizeOptionalAccountId,
} from "genesis/plugin-sdk/account-id";
import {
  listCombinedAccountIds,
  resolveListedDefaultAccountId,
} from "genesis/plugin-sdk/account-resolution";
import { loadBundledEntryExportSync } from "genesis/plugin-sdk/channel-entry-contract";
import type { GenesisConfig } from "genesis/plugin-sdk/config-runtime";
import { normalizeSecretInputString, type SecretInput } from "genesis/plugin-sdk/secret-input";
import { normalizeOptionalString } from "genesis/plugin-sdk/text-runtime";
import type { NostrProfile } from "./config-schema.js";
import { DEFAULT_RELAYS } from "./default-relays.js";

// nostr-tools is a real dependency of nostr-key-utils.ts, not always staged
// when this module is reached from the setup-only surface (Genesis skips
// installing bundled runtime deps just to list/status-check a not-yet-enabled
// channel). Load it through the same synchronous, dev/test/prod-safe loader
// the channel entry itself uses (extensions/nostr/index.ts), with
// installRuntimeDeps disabled so a cold listing pass degrades to an empty
// publicKey instead of crashing. Once the channel is actually activated,
// nostr-tools is already staged, so this resolves synchronously and
// correctly like a normal import.
function resolvePublicKeyBestEffort(privateKey: string): string {
  try {
    const getPublicKeyFromPrivate = loadBundledEntryExportSync<(key: string) => string>(
      import.meta.url,
      { specifier: "./nostr-key-utils.js", exportName: "getPublicKeyFromPrivate" },
      { installRuntimeDeps: false },
    );
    return getPublicKeyFromPrivate(privateKey);
  } catch {
    return "";
  }
}

export interface NostrAccountConfig {
  enabled?: boolean;
  name?: string;
  defaultAccount?: string;
  privateKey?: SecretInput;
  relays?: string[];
  dmPolicy?: "pairing" | "allowlist" | "open" | "disabled";
  allowFrom?: Array<string | number>;
  profile?: NostrProfile;
}

export interface ResolvedNostrAccount {
  accountId: string;
  name?: string;
  enabled: boolean;
  configured: boolean;
  privateKey: string;
  publicKey: string;
  relays: string[];
  profile?: NostrProfile;
  config: NostrAccountConfig;
}

function resolveConfiguredDefaultNostrAccountId(cfg: GenesisConfig): string | undefined {
  const nostrCfg = (cfg.channels as Record<string, unknown> | undefined)?.nostr as
    | NostrAccountConfig
    | undefined;
  return normalizeOptionalAccountId(nostrCfg?.defaultAccount);
}

/**
 * List all configured Nostr account IDs
 */
export function listNostrAccountIds(cfg: GenesisConfig): string[] {
  const nostrCfg = (cfg.channels as Record<string, unknown> | undefined)?.nostr as
    | NostrAccountConfig
    | undefined;
  const privateKey = normalizeSecretInputString(nostrCfg?.privateKey);
  return listCombinedAccountIds({
    configuredAccountIds: [],
    implicitAccountId: privateKey
      ? (resolveConfiguredDefaultNostrAccountId(cfg) ?? DEFAULT_ACCOUNT_ID)
      : undefined,
  });
}

/**
 * Get the default account ID
 */
export function resolveDefaultNostrAccountId(cfg: GenesisConfig): string {
  return resolveListedDefaultAccountId({
    accountIds: listNostrAccountIds(cfg),
    configuredDefaultAccountId: resolveConfiguredDefaultNostrAccountId(cfg),
  });
}

/**
 * Resolve a Nostr account from config
 */
export function resolveNostrAccount(opts: {
  cfg: GenesisConfig;
  accountId?: string | null;
}): ResolvedNostrAccount {
  const accountId = normalizeAccountId(opts.accountId ?? resolveDefaultNostrAccountId(opts.cfg));
  const nostrCfg = (opts.cfg.channels as Record<string, unknown> | undefined)?.nostr as
    | NostrAccountConfig
    | undefined;

  const baseEnabled = nostrCfg?.enabled !== false;
  const privateKey = normalizeSecretInputString(nostrCfg?.privateKey) ?? "";
  const configured = Boolean(privateKey);

  const publicKey = privateKey ? resolvePublicKeyBestEffort(privateKey) : "";

  return {
    accountId,
    name: normalizeOptionalString(nostrCfg?.name),
    enabled: baseEnabled,
    configured,
    privateKey,
    publicKey,
    relays: nostrCfg?.relays ?? DEFAULT_RELAYS,
    profile: nostrCfg?.profile,
    config: {
      enabled: nostrCfg?.enabled,
      name: nostrCfg?.name,
      privateKey: nostrCfg?.privateKey,
      relays: nostrCfg?.relays,
      dmPolicy: nostrCfg?.dmPolicy,
      allowFrom: nostrCfg?.allowFrom,
      profile: nostrCfg?.profile,
    },
  };
}
