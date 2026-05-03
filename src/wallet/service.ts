import { loadConfig } from "../config/config.js";
import type { WalletChain, WalletConfig } from "../config/types.wallet.js";
import { compareDecimalAmounts } from "./amounts.js";
import {
  assertValidWalletMnemonic,
  derivePublicAccounts,
  generateWalletMnemonic,
  getWalletBalance,
  isLocalKeystoreWalletChain,
  quoteWalletSend,
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
  WalletPrivatePayload,
  WalletPublicAccount,
  WalletQuote,
  WalletSendResult,
  WalletSummary,
} from "./types.js";
import { getXmrAddress, getXmrBalance, quoteXmrSend, sendXmrTransaction } from "./xmr-rpc.js";

export type WalletServiceOptions = {
  config?: WalletConfig;
  env?: NodeJS.ProcessEnv;
};

export type WalletInitParams = WalletServiceOptions & {
  passphrase: string;
  mnemonic?: string;
  chains?: readonly LocalKeystoreWalletChain[];
  overwrite?: boolean;
};

export type WalletRecoveryPhraseMode = "generate" | "import";

export type WalletRecoveryPhraseSetParams = WalletServiceOptions & {
  mode: WalletRecoveryPhraseMode;
  passphrase: string;
  mnemonic?: string;
  overwrite?: boolean;
};

export type WalletSendGuard = {
  yes?: boolean;
  allowEnv?: NodeJS.ProcessEnv;
};

function resolveConfig(config?: WalletConfig): WalletConfig | undefined {
  return config ?? loadConfig().wallet;
}

function walletEnabled(config?: WalletConfig): boolean {
  return config?.enabled !== false;
}

function primaryAccount(
  accounts: readonly WalletPublicAccount[],
  config?: WalletConfig,
): string | undefined {
  const configured = config?.primaryAccount?.trim();
  if (configured && accounts.some((account) => account.id === configured)) {
    return configured;
  }
  return accounts[0]?.id;
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
  const accounts = keystore?.public.accounts ? [...keystore.public.accounts] : [];
  if (!walletEnabled(config)) {
    warnings.push("wallet disabled by config");
  }
  if (config?.networks?.xmr?.enabled !== false && config?.networks?.xmr?.walletRpcUrl) {
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
    primaryAccount: keystore?.public.primaryAccount ?? primaryAccount(accounts, config),
    accounts,
    warnings,
  };
}

export async function initWallet(params: WalletInitParams): Promise<{
  mnemonicGenerated: boolean;
  summary: WalletSummary;
}> {
  const existing = await readWalletKeystore(params.env);
  if (existing && !params.overwrite) {
    throw new Error("Wallet keystore already exists. Pass --overwrite to replace it.");
  }
  const config = resolveConfig(params.config);
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
    passphrase: params.passphrase,
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
    passphrase: params.passphrase,
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

function assertSpendGuard(params: {
  chain: WalletChain;
  amount: string;
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
  if (spending.maxNativeAmount) {
    const decimals = nativeAssetDecimals(params.chain);
    if (compareDecimalAmounts(params.amount, spending.maxNativeAmount, decimals) > 0) {
      throw new Error(
        `Wallet send exceeds wallet.spending.maxNativeAmount (${spending.maxNativeAmount}).`,
      );
    }
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
