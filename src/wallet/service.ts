import { loadConfig } from "../config/config.js";
import type { WalletChain, WalletConfig } from "../config/types.wallet.js";
import { compareDecimalAmounts, formatAtomicAmount } from "./amounts.js";
import {
  assertValidWalletMnemonic,
  broadcastWalletRawTransactionPayload,
  derivePublicAccounts,
  expandEvmPublicAccounts,
  generateWalletMnemonic,
  getWalletBalance,
  getWalletNftCollections,
  getWalletTokenBalances,
  isLocalKeystoreWalletChain,
  quoteWalletSend,
  resolveEvmNetworks,
  signWalletDigestPayload,
  signWalletMessagePayload,
  signWalletRawTransactionPayload,
  sendWalletTransaction,
} from "./chains.js";
import {
  decryptWalletPayload,
  encryptWalletPayload,
  readWalletKeystore,
  writeWalletKeystore,
} from "./keystore.js";
import type {
  LocalKeystoreWalletChain,
  WalletBalance,
  WalletBroadcastResult,
  WalletNftCollection,
  WalletPrivatePayload,
  WalletPublicAccount,
  WalletQuote,
  WalletSendResult,
  WalletSignatureResult,
  WalletSignedRawTransaction,
  WalletSummary,
  WalletTokenBalance,
} from "./types.js";
import { getXmrAddress, getXmrBalance, quoteXmrSend, sendXmrTransaction } from "./xmr-rpc.js";

export type WalletServiceOptions = {
  config?: WalletConfig;
  env?: NodeJS.ProcessEnv;
};

export type WalletInitParams = WalletServiceOptions & {
  passphrase?: string;
  mnemonic?: string;
  chains?: readonly LocalKeystoreWalletChain[];
  overwrite?: boolean;
};

export type WalletRecoveryPhraseMode = "generate" | "import";

export type WalletRecoveryPhraseSetParams = WalletServiceOptions & {
  mode: WalletRecoveryPhraseMode;
  passphrase?: string;
  mnemonic?: string;
  overwrite?: boolean;
};

export type WalletSendGuard = {
  yes?: boolean;
  allowEnv?: NodeJS.ProcessEnv;
};

export type WalletSignGuard = {
  yes?: boolean;
};

function resolveConfig(config?: WalletConfig): WalletConfig | undefined {
  return config ?? loadConfig().wallet;
}

function walletEnabled(config?: WalletConfig): boolean {
  return config?.enabled !== false;
}

function walletNetworkEnabled(config: WalletConfig | undefined, chain: WalletChain): boolean {
  return config?.networks?.[chain]?.enabled !== false;
}

function assertWalletOperationEnabled(config: WalletConfig | undefined, chain?: WalletChain) {
  if (!walletEnabled(config)) {
    throw new Error("Wallet is disabled by config.");
  }
  if (chain && !walletNetworkEnabled(config, chain)) {
    throw new Error(`Wallet network ${chain} is disabled by config.`);
  }
}

function filterEnabledAccounts(
  accounts: readonly WalletPublicAccount[],
  config?: WalletConfig,
): WalletPublicAccount[] {
  if (!walletEnabled(config)) {
    return [];
  }
  const evmAccountIds = new Set(
    resolveEvmNetworks(config?.networks?.evm).map((network) => network.accountId),
  );
  return accounts.filter((account) => {
    if (!walletNetworkEnabled(config, account.chain)) {
      return false;
    }
    if (account.chain !== "evm") {
      return true;
    }
    return evmAccountIds.size === 0 ? false : evmAccountIds.has(account.id);
  });
}

function primaryAccount(
  accounts: readonly WalletPublicAccount[],
  config?: WalletConfig,
): string | undefined {
  const configured = config?.primaryAccount?.trim();
  if (configured === "evm:default" && accounts.some((account) => account.id === "evm:ethereum")) {
    return "evm:ethereum";
  }
  if (configured && accounts.some((account) => account.id === configured)) {
    return configured;
  }
  return accounts[0]?.id;
}

function normalizePrimaryAccount(
  primary: string | undefined,
  accounts: readonly WalletPublicAccount[],
) {
  const normalized =
    primary === "evm:default" && accounts.some((account) => account.id === "evm:ethereum")
      ? "evm:ethereum"
      : primary;
  return normalized && accounts.some((account) => account.id === normalized)
    ? normalized
    : undefined;
}

function nativeAssetDecimals(chain: WalletChain): number {
  if (chain === "btc") {
    return 8;
  }
  if (chain === "sol") {
    return 9;
  }
  if (chain === "trx") {
    return 6;
  }
  if (chain === "xmr") {
    return 12;
  }
  return 18;
}

export async function getWalletSummary(options: WalletServiceOptions = {}): Promise<WalletSummary> {
  const config = resolveConfig(options.config);
  const warnings: string[] = [];
  const keystore = await readWalletKeystore(options.env);
  const accounts = filterEnabledAccounts(
    expandEvmPublicAccounts(keystore?.public.accounts ? [...keystore.public.accounts] : [], config),
    config,
  );
  if (!walletEnabled(config)) {
    warnings.push("wallet disabled by config");
  }
  if (
    walletEnabled(config) &&
    config?.networks?.xmr?.enabled !== false &&
    config?.networks?.xmr?.walletRpcUrl
  ) {
    try {
      const address = await getXmrAddress(config);
      accounts.push({
        id: "xmr:rpc",
        chain: "xmr",
        address,
        network: "monero-wallet-rpc",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    } catch (error) {
      warnings.push(error instanceof Error ? error.message : String(error));
    }
  }
  return {
    enabled: walletEnabled(config),
    keystore: { exists: Boolean(keystore), locked: true },
    primaryAccount: normalizePrimaryAccount(
      keystore?.public.primaryAccount ?? primaryAccount(accounts, config),
      accounts,
    ),
    accounts,
    warnings,
  };
}

export async function initWallet(params: WalletInitParams): Promise<{
  mnemonicGenerated: boolean;
  summary: WalletSummary;
}> {
  const config = resolveConfig(params.config);
  assertWalletOperationEnabled(config);
  const existing = await readWalletKeystore(params.env);
  if (existing && !params.overwrite) {
    throw new Error("Wallet keystore already exists. Pass --overwrite to replace it.");
  }
  const mnemonic = params.mnemonic
    ? assertValidWalletMnemonic(params.mnemonic)
    : generateWalletMnemonic();
  const payload: WalletPrivatePayload = {
    version: 1,
    mnemonic,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const accounts = await derivePublicAccounts({ mnemonic, config, chains: params.chains });
  const primary = primaryAccount(accounts, config);
  const file = await encryptWalletPayload({
    payload,
    publicAccounts: accounts,
    primaryAccount: primary,
    passphrase: params.passphrase ?? "",
  });
  await writeWalletKeystore(file, params.env);
  return {
    mnemonicGenerated: !params.mnemonic,
    summary: await getWalletSummary({ config, env: params.env }),
  };
}

export async function importWallet(params: WalletInitParams & { mnemonic: string }) {
  return initWallet(params);
}

export async function setWalletRecoveryPhrase(params: WalletRecoveryPhraseSetParams): Promise<{
  mnemonicGenerated: boolean;
  mnemonic?: string;
  summary: WalletSummary;
}> {
  const mnemonic =
    params.mode === "generate"
      ? generateWalletMnemonic()
      : assertValidWalletMnemonic(params.mnemonic ?? "");
  const result = await initWallet({
    config: params.config,
    env: params.env,
    passphrase: params.passphrase ?? "",
    mnemonic,
    overwrite: params.overwrite,
  });
  return {
    mnemonicGenerated: params.mode === "generate",
    ...(params.mode === "generate" ? { mnemonic } : {}),
    summary: result.summary,
  };
}

export async function unlockWalletMnemonic(params: {
  passphrase: string;
  env?: NodeJS.ProcessEnv;
}): Promise<string> {
  const keystore = await readWalletKeystore(params.env);
  if (!keystore) {
    throw new Error("Wallet keystore not found. Run genesis wallet init or import first.");
  }
  const payload = await decryptWalletPayload(keystore, params.passphrase);
  return assertValidWalletMnemonic(payload.mnemonic);
}

export async function getWalletAccounts(options: WalletServiceOptions = {}) {
  return (await getWalletSummary(options)).accounts;
}

export async function getWalletBalanceForChain(
  params: WalletServiceOptions & {
    chain: WalletChain;
    accountId?: string;
  },
): Promise<WalletBalance> {
  const config = resolveConfig(params.config);
  assertWalletOperationEnabled(config, params.chain);
  if (params.chain === "xmr") {
    return getXmrBalance(config);
  }
  const accounts = await getWalletAccounts({ config, env: params.env });
  return getWalletBalance({
    chain: params.chain,
    accountId: params.accountId,
    accounts,
    config,
  });
}

export async function getWalletTokenBalancesForAccount(
  params: WalletServiceOptions & {
    accountId?: string;
  } = {},
): Promise<WalletTokenBalance[]> {
  const config = resolveConfig(params.config);
  assertWalletOperationEnabled(config, "evm");
  const accounts = await getWalletAccounts({ config, env: params.env });
  return getWalletTokenBalances({
    accounts,
    accountId: params.accountId,
    config,
  });
}

export async function getWalletNftCollectionsForAccount(
  params: WalletServiceOptions & {
    accountId?: string;
  } = {},
): Promise<WalletNftCollection[]> {
  const config = resolveConfig(params.config);
  assertWalletOperationEnabled(config, "evm");
  const accounts = await getWalletAccounts({ config, env: params.env });
  return getWalletNftCollections({
    accounts,
    accountId: params.accountId,
    config,
  });
}

function assertSpendGuard(params: {
  chain: WalletChain;
  amount?: string;
  config?: WalletConfig;
  guard?: WalletSendGuard;
}) {
  const spending = params.config?.spending;
  if (spending?.enabled !== true) {
    throw new Error("Wallet spending is disabled. Set wallet.spending.enabled: true.");
  }
  if (params.guard?.yes !== true) {
    throw new Error("Wallet send requires --yes.");
  }
  if (
    (spending.requireAllowEnv ?? true) &&
    params.guard.allowEnv?.GENESIS_WALLET_ALLOW_SPEND !== "1"
  ) {
    throw new Error("Wallet send requires GENESIS_WALLET_ALLOW_SPEND=1.");
  }
  if (params.amount !== undefined && spending.maxNativeAmount) {
    const decimals = nativeAssetDecimals(params.chain);
    if (compareDecimalAmounts(params.amount, spending.maxNativeAmount, decimals) > 0) {
      throw new Error(
        `Wallet send exceeds wallet.spending.maxNativeAmount (${spending.maxNativeAmount}).`,
      );
    }
  }
}

function parseAtomicNumberish(value: unknown, label: string): bigint | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!/^(0x[0-9a-fA-F]+|[0-9]+)$/.test(trimmed)) {
      throw new Error(`${label} must be a non-negative integer or 0x-prefixed integer.`);
    }
    return BigInt(trimmed);
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`${label} must be a non-negative safe integer.`);
    }
    return BigInt(value);
  }
  if (typeof value === "bigint") {
    if (value < 0n) {
      throw new Error(`${label} must be non-negative.`);
    }
    return value;
  }
  throw new Error(`${label} must be a non-negative integer.`);
}

function nativeAmountFromRawTransaction(
  chain: WalletChain,
  transaction: Record<string, unknown>,
): string | undefined {
  if (chain !== "evm") {
    return undefined;
  }
  const value = parseAtomicNumberish(transaction.value, "transaction.value");
  return value === undefined ? undefined : formatAtomicAmount(value, nativeAssetDecimals(chain));
}

function assertSignGuard(params: { guard?: WalletSignGuard }) {
  if (params.guard?.yes !== true) {
    throw new Error("Wallet signing requires --yes.");
  }
}

function unsupportedWalletChainError(chain: WalletChain): Error {
  return new Error(`Unsupported wallet chain: ${chain}`);
}

export async function quoteWalletTransaction(
  params: WalletServiceOptions & {
    chain: WalletChain;
    accountId?: string;
    to: string;
    amount: string;
  },
): Promise<WalletQuote> {
  const config = resolveConfig(params.config);
  assertWalletOperationEnabled(config, params.chain);
  if (params.chain === "xmr") {
    return quoteXmrSend({ to: params.to, amount: params.amount, config });
  }
  if (!isLocalKeystoreWalletChain(params.chain)) {
    throw unsupportedWalletChainError(params.chain);
  }
  const accounts = await getWalletAccounts({ config, env: params.env });
  return quoteWalletSend({
    chain: params.chain,
    accounts,
    accountId: params.accountId,
    to: params.to,
    amount: params.amount,
    config,
  });
}

export async function sendWallet(
  params: WalletServiceOptions & {
    chain: WalletChain;
    accountId?: string;
    to: string;
    amount: string;
    passphrase: string;
    guard?: WalletSendGuard;
  },
): Promise<WalletSendResult> {
  const config = resolveConfig(params.config);
  assertWalletOperationEnabled(config, params.chain);
  assertSpendGuard({
    chain: params.chain,
    amount: params.amount,
    config,
    guard: params.guard,
  });
  if (params.chain === "xmr") {
    return sendXmrTransaction({ to: params.to, amount: params.amount, config });
  }
  if (!isLocalKeystoreWalletChain(params.chain)) {
    throw unsupportedWalletChainError(params.chain);
  }
  const mnemonic = await unlockWalletMnemonic({ passphrase: params.passphrase, env: params.env });
  const accounts = await getWalletAccounts({ config, env: params.env });
  return sendWalletTransaction({
    chain: params.chain,
    accounts,
    accountId: params.accountId,
    to: params.to,
    amount: params.amount,
    mnemonic,
    config,
  });
}

export async function signWalletMessage(
  params: WalletServiceOptions & {
    chain: WalletChain;
    accountId?: string;
    message?: string;
    messageHex?: string;
    passphrase: string;
    guard?: WalletSignGuard;
  },
): Promise<WalletSignatureResult> {
  assertSignGuard({ guard: params.guard });
  const config = resolveConfig(params.config);
  assertWalletOperationEnabled(config, params.chain);
  if (!isLocalKeystoreWalletChain(params.chain)) {
    throw unsupportedWalletChainError(params.chain);
  }
  const mnemonic = await unlockWalletMnemonic({ passphrase: params.passphrase, env: params.env });
  const accounts = await getWalletAccounts({ config, env: params.env });
  return signWalletMessagePayload({
    chain: params.chain,
    accounts,
    accountId: params.accountId,
    mnemonic,
    message: params.message,
    messageHex: params.messageHex,
    config,
  });
}

export async function signWalletDigest(
  params: WalletServiceOptions & {
    chain: WalletChain;
    accountId?: string;
    digest: string;
    passphrase: string;
    guard?: WalletSignGuard;
  },
): Promise<WalletSignatureResult> {
  assertSignGuard({ guard: params.guard });
  const config = resolveConfig(params.config);
  assertWalletOperationEnabled(config, params.chain);
  if (!isLocalKeystoreWalletChain(params.chain)) {
    throw unsupportedWalletChainError(params.chain);
  }
  const mnemonic = await unlockWalletMnemonic({ passphrase: params.passphrase, env: params.env });
  const accounts = await getWalletAccounts({ config, env: params.env });
  return signWalletDigestPayload({
    chain: params.chain,
    accounts,
    accountId: params.accountId,
    mnemonic,
    digest: params.digest,
    config,
  });
}

export async function signWalletRawTransaction(
  params: WalletServiceOptions & {
    chain: WalletChain;
    accountId?: string;
    transaction: Record<string, unknown>;
    passphrase: string;
    guard?: WalletSendGuard;
  },
): Promise<WalletSignedRawTransaction> {
  const config = resolveConfig(params.config);
  assertWalletOperationEnabled(config, params.chain);
  assertSpendGuard({
    chain: params.chain,
    amount: nativeAmountFromRawTransaction(params.chain, params.transaction),
    config,
    guard: params.guard,
  });
  if (!isLocalKeystoreWalletChain(params.chain)) {
    throw unsupportedWalletChainError(params.chain);
  }
  const mnemonic = await unlockWalletMnemonic({ passphrase: params.passphrase, env: params.env });
  const accounts = await getWalletAccounts({ config, env: params.env });
  return signWalletRawTransactionPayload({
    chain: params.chain,
    accounts,
    accountId: params.accountId,
    mnemonic,
    transaction: params.transaction,
    config,
  });
}

export async function broadcastWalletRawTransaction(
  params: WalletServiceOptions & {
    chain: WalletChain;
    accountId?: string;
    rawTransaction: string;
    passphrase: string;
    guard?: WalletSendGuard;
  },
): Promise<WalletBroadcastResult> {
  const config = resolveConfig(params.config);
  assertWalletOperationEnabled(config, params.chain);
  assertSpendGuard({
    chain: params.chain,
    config,
    guard: params.guard,
  });
  if (!isLocalKeystoreWalletChain(params.chain)) {
    throw unsupportedWalletChainError(params.chain);
  }
  await unlockWalletMnemonic({ passphrase: params.passphrase, env: params.env });
  const accounts = await getWalletAccounts({ config, env: params.env });
  return broadcastWalletRawTransactionPayload({
    chain: params.chain,
    accounts,
    accountId: params.accountId,
    rawTransaction: params.rawTransaction,
    config,
  });
}
