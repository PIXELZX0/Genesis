import { Buffer } from "node:buffer";
import { HDKey } from "@scure/bip32";
import { generateMnemonic, mnemonicToSeedSync, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
  clusterApiUrl,
} from "@solana/web3.js";
import * as bitcoin from "bitcoinjs-lib";
import { ECPairFactory } from "ecpair";
import {
  HDNodeWallet,
  JsonRpcProvider,
  Wallet as EvmWallet,
  formatEther,
  parseEther,
} from "ethers";
import * as ecc from "tiny-secp256k1";
import { TronWeb } from "tronweb";
import { normalizeResolvedSecretInputString } from "../config/types.secrets.js";
import type {
  WalletBtcNetworkConfig,
  WalletChain,
  WalletConfig,
  WalletEvmNetworkConfig,
  WalletSolNetworkConfig,
  WalletTrxNetworkConfig,
} from "../config/types.wallet.js";
import { formatAtomicAmount, parseDecimalAmount } from "./amounts.js";
import {
  DEFAULT_DERIVATION_PATHS,
  LOCAL_KEYSTORE_WALLET_CHAINS,
  type LocalKeystoreWalletChain,
  type WalletBalance,
  type WalletPrivateMaterial,
  type WalletPublicAccount,
  type WalletQuote,
  type WalletSendResult,
} from "./types.js";

type Ed25519HdKeyModule = {
  derivePath: (path: string, seed: string) => { key: Buffer; chainCode: Buffer };
};

const ECPair = ECPairFactory(ecc);
bitcoin.initEccLib(ecc);

function normalizeAccountId(chain: WalletChain): string {
  return `${chain}:default`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function enabled(config: { enabled?: boolean } | undefined): boolean {
  return config?.enabled !== false;
}

function resolveBtcNetwork(config?: WalletBtcNetworkConfig) {
  const name = config?.network ?? "mainnet";
  if (name === "testnet") {
    return { name, coinType: 1, network: bitcoin.networks.testnet };
  }
  if (name === "regtest") {
    return { name, coinType: 1, network: bitcoin.networks.regtest };
  }
  return { name, coinType: 0, network: bitcoin.networks.bitcoin };
}

function resolveBtcPath(config?: WalletBtcNetworkConfig): string {
  const network = resolveBtcNetwork(config);
  return config?.derivationPath ?? `m/84'/${network.coinType}'/0'/0/0`;
}

function resolveEvmPath(config?: WalletEvmNetworkConfig): string {
  return config?.derivationPath ?? DEFAULT_DERIVATION_PATHS.evm;
}

function resolveSolPath(config?: WalletSolNetworkConfig): string {
  return config?.derivationPath ?? DEFAULT_DERIVATION_PATHS.sol;
}

function resolveTrxPath(config?: WalletTrxNetworkConfig): string {
  return config?.derivationPath ?? DEFAULT_DERIVATION_PATHS.trx;
}

function resolveSecretString(value: unknown, path: string): string | undefined {
  return normalizeResolvedSecretInputString({ value, path });
}

async function loadEd25519HdKey(): Promise<Ed25519HdKeyModule> {
  return (await import("ed25519-hd-key")) as Ed25519HdKeyModule;
}

export function generateWalletMnemonic(): string {
  return generateMnemonic(wordlist, 256);
}

export function assertValidWalletMnemonic(mnemonic: string): string {
  const normalized = mnemonic.trim().replace(/\s+/g, " ");
  if (!validateMnemonic(normalized, wordlist)) {
    throw new Error("Invalid BIP39 mnemonic.");
  }
  return normalized;
}

function deriveBtcMaterial(
  mnemonic: string,
  config?: WalletBtcNetworkConfig,
): WalletPrivateMaterial {
  const seed = mnemonicToSeedSync(mnemonic);
  const path = resolveBtcPath(config);
  const hd = HDKey.fromMasterSeed(seed).derive(path);
  if (!hd.privateKey || !hd.publicKey) {
    throw new Error("Unable to derive Bitcoin private key.");
  }
  const network = resolveBtcNetwork(config);
  const keyPair = ECPair.fromPrivateKey(Buffer.from(hd.privateKey), { network: network.network });
  const payment = bitcoin.payments.p2wpkh({
    pubkey: Buffer.from(keyPair.publicKey),
    network: network.network,
  });
  if (!payment.address) {
    throw new Error("Unable to derive Bitcoin address.");
  }
  return {
    chain: "btc",
    address: payment.address,
    privateKey: hd.privateKey,
    publicKey: hd.publicKey,
    derivationPath: path,
    network: network.name,
  };
}

function deriveEvmMaterial(
  mnemonic: string,
  config?: WalletEvmNetworkConfig,
): WalletPrivateMaterial {
  const path = resolveEvmPath(config);
  const wallet = HDNodeWallet.fromPhrase(mnemonic, undefined, path);
  return {
    chain: "evm",
    address: wallet.address,
    privateKey: wallet.privateKey,
    publicKey: wallet.publicKey ? Buffer.from(wallet.publicKey.slice(2), "hex") : undefined,
    derivationPath: path,
    network: config?.name ?? (config?.chainId ? `chain-${config.chainId}` : "evm"),
  };
}

async function deriveSolMaterial(
  mnemonic: string,
  config?: WalletSolNetworkConfig,
): Promise<WalletPrivateMaterial> {
  const path = resolveSolPath(config);
  const seed = mnemonicToSeedSync(mnemonic);
  const { derivePath } = await loadEd25519HdKey();
  const derived = derivePath(path, Buffer.from(seed).toString("hex"));
  const keypair = Keypair.fromSeed(derived.key);
  return {
    chain: "sol",
    address: keypair.publicKey.toBase58(),
    privateKey: derived.key,
    publicKey: keypair.publicKey.toBytes(),
    derivationPath: path,
    network: config?.network ?? "mainnet-beta",
  };
}

function deriveTrxMaterial(
  mnemonic: string,
  config?: WalletTrxNetworkConfig,
): WalletPrivateMaterial {
  const path = resolveTrxPath(config);
  const account = TronWeb.fromMnemonic(mnemonic, path);
  return {
    chain: "trx",
    address: account.address,
    privateKey: account.privateKey,
    publicKey: Buffer.from(account.publicKey.replace(/^0x/, ""), "hex"),
    derivationPath: path,
    network: "tron",
  };
}

export async function derivePrivateMaterial(params: {
  mnemonic: string;
  chain: LocalKeystoreWalletChain;
  config?: WalletConfig;
}): Promise<WalletPrivateMaterial> {
  const mnemonic = assertValidWalletMnemonic(params.mnemonic);
  if (params.chain === "btc") {
    return deriveBtcMaterial(mnemonic, params.config?.networks?.btc);
  }
  if (params.chain === "evm") {
    return deriveEvmMaterial(mnemonic, params.config?.networks?.evm);
  }
  if (params.chain === "sol") {
    return deriveSolMaterial(mnemonic, params.config?.networks?.sol);
  }
  return deriveTrxMaterial(mnemonic, params.config?.networks?.trx);
}

export async function derivePublicAccounts(params: {
  mnemonic: string;
  config?: WalletConfig;
  chains?: readonly LocalKeystoreWalletChain[];
}): Promise<WalletPublicAccount[]> {
  const createdAt = nowIso();
  const chains = params.chains ?? LOCAL_KEYSTORE_WALLET_CHAINS;
  const accounts: WalletPublicAccount[] = [];
  for (const chain of chains) {
    const networkConfig = params.config?.networks?.[chain];
    if (!enabled(networkConfig)) {
      continue;
    }
    const material = await derivePrivateMaterial({
      mnemonic: params.mnemonic,
      chain,
      config: params.config,
    });
    accounts.push({
      id: normalizeAccountId(chain),
      chain,
      address: material.address,
      derivationPath: material.derivationPath,
      network: material.network,
      createdAt,
      updatedAt: createdAt,
    });
  }
  return accounts;
}

function requireAccount(
  accounts: readonly WalletPublicAccount[],
  chain: WalletChain,
  accountId?: string,
): WalletPublicAccount {
  const id = accountId?.trim() || normalizeAccountId(chain);
  const account = accounts.find((entry) => entry.id === id && entry.chain === chain);
  if (!account) {
    throw new Error(`Wallet account not found for ${chain}: ${id}`);
  }
  return account;
}

function resolveEvmProvider(config?: WalletEvmNetworkConfig): JsonRpcProvider {
  const rpcUrl = resolveSecretString(config?.rpcUrl, "wallet.networks.evm.rpcUrl");
  if (!rpcUrl) {
    throw new Error("wallet.networks.evm.rpcUrl is required for EVM balance and send.");
  }
  return new JsonRpcProvider(rpcUrl, config?.chainId);
}

function resolveSolConnection(config?: WalletSolNetworkConfig): Connection {
  const rpcUrl =
    resolveSecretString(config?.rpcUrl, "wallet.networks.sol.rpcUrl") ??
    clusterApiUrl(config?.network ?? "mainnet-beta");
  return new Connection(rpcUrl, "confirmed");
}

function resolveTronWeb(config?: WalletTrxNetworkConfig, privateKey?: string): TronWeb {
  const fullHost =
    resolveSecretString(config?.fullHost, "wallet.networks.trx.fullHost") ??
    "https://api.trongrid.io";
  const apiKey = resolveSecretString(config?.apiKey, "wallet.networks.trx.apiKey");
  const tronWeb = new TronWeb({
    fullHost,
    privateKey,
    headers: apiKey ? { "TRON-PRO-API-KEY": apiKey } : undefined,
  });
  return tronWeb;
}

function resolveBtcEsploraUrl(config?: WalletBtcNetworkConfig): string {
  const explicit = resolveSecretString(config?.esploraUrl, "wallet.networks.btc.esploraUrl");
  if (explicit) {
    return explicit.replace(/\/+$/, "");
  }
  const network = resolveBtcNetwork(config).name;
  if (network === "mainnet") {
    return "https://blockstream.info/api";
  }
  if (network === "testnet") {
    return "https://blockstream.info/testnet/api";
  }
  throw new Error("wallet.networks.btc.esploraUrl is required for regtest.");
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`HTTP ${response.status} from ${url}${body ? `: ${body.slice(0, 300)}` : ""}`);
  }
  return (await response.json()) as T;
}

async function fetchText(url: string, init?: RequestInit): Promise<string> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`HTTP ${response.status} from ${url}${body ? `: ${body.slice(0, 300)}` : ""}`);
  }
  return response.text();
}

type BtcUtxo = {
  txid: string;
  vout: number;
  value: number;
  status?: { confirmed?: boolean };
};

async function fetchBtcUtxos(address: string, config?: WalletBtcNetworkConfig): Promise<BtcUtxo[]> {
  const base = resolveBtcEsploraUrl(config);
  return fetchJson<BtcUtxo[]>(`${base}/address/${address}/utxo`);
}

async function quoteBtc(params: {
  accounts: readonly WalletPublicAccount[];
  accountId?: string;
  to: string;
  amount: string;
  config?: WalletBtcNetworkConfig;
}): Promise<WalletQuote> {
  const account = requireAccount(params.accounts, "btc", params.accountId);
  const amountAtomic = parseDecimalAmount(params.amount, 8);
  const network = resolveBtcNetwork(params.config);
  bitcoin.address.toOutputScript(params.to, network.network);
  const utxos = (await fetchBtcUtxos(account.address, params.config)).filter(
    (utxo) => utxo.status?.confirmed !== false,
  );
  const feeRate = params.config?.feeRateSatPerVbyte ?? 5;
  let selected = 0n;
  let selectedCount = 0;
  let fee = 0n;
  for (const utxo of utxos.toSorted((a, b) => b.value - a.value)) {
    selected += BigInt(utxo.value);
    selectedCount += 1;
    fee = BigInt(Math.ceil((10 + selectedCount * 68 + 2 * 31) * feeRate));
    if (selected >= amountAtomic + fee) {
      break;
    }
  }
  if (selected < amountAtomic + fee) {
    throw new Error("Insufficient confirmed Bitcoin UTXO balance.");
  }
  return {
    chain: "btc",
    accountId: account.id,
    network: account.network,
    from: account.address,
    to: params.to,
    asset: "BTC",
    amountAtomic: amountAtomic.toString(),
    amount: formatAtomicAmount(amountAtomic, 8),
    estimatedFeeAtomic: fee.toString(),
    estimatedFee: formatAtomicAmount(fee, 8),
  };
}

export async function getWalletBalance(params: {
  chain: WalletChain;
  accounts: readonly WalletPublicAccount[];
  accountId?: string;
  config?: WalletConfig;
}): Promise<WalletBalance> {
  if (params.chain === "btc") {
    const account = requireAccount(params.accounts, "btc", params.accountId);
    const utxos = await fetchBtcUtxos(account.address, params.config?.networks?.btc);
    const confirmed = utxos
      .filter((utxo) => utxo.status?.confirmed !== false)
      .reduce((sum, utxo) => sum + BigInt(utxo.value), 0n);
    const total = utxos.reduce((sum, utxo) => sum + BigInt(utxo.value), 0n);
    return {
      chain: "btc",
      accountId: account.id,
      address: account.address,
      network: account.network,
      asset: "BTC",
      amountAtomic: total.toString(),
      amount: formatAtomicAmount(total, 8),
      confirmedAmountAtomic: confirmed.toString(),
      pendingAmountAtomic: (total - confirmed).toString(),
    };
  }
  if (params.chain === "evm") {
    const account = requireAccount(params.accounts, "evm", params.accountId);
    const provider = resolveEvmProvider(params.config?.networks?.evm);
    const balance = await provider.getBalance(account.address);
    return {
      chain: "evm",
      accountId: account.id,
      address: account.address,
      network: account.network,
      asset: params.config?.networks?.evm?.currencySymbol ?? "ETH",
      amountAtomic: balance.toString(),
      amount: formatEther(balance),
    };
  }
  if (params.chain === "sol") {
    const account = requireAccount(params.accounts, "sol", params.accountId);
    const connection = resolveSolConnection(params.config?.networks?.sol);
    const balance = BigInt(await connection.getBalance(new PublicKey(account.address)));
    return {
      chain: "sol",
      accountId: account.id,
      address: account.address,
      network: account.network,
      asset: "SOL",
      amountAtomic: balance.toString(),
      amount: formatAtomicAmount(balance, 9),
    };
  }
  if (params.chain === "trx") {
    const account = requireAccount(params.accounts, "trx", params.accountId);
    const tronWeb = resolveTronWeb(params.config?.networks?.trx);
    const balance = BigInt(await tronWeb.trx.getBalance(account.address));
    return {
      chain: "trx",
      accountId: account.id,
      address: account.address,
      network: account.network,
      asset: "TRX",
      amountAtomic: balance.toString(),
      amount: formatAtomicAmount(balance, 6),
    };
  }
  throw new Error("Use the Monero wallet RPC helper for XMR balances.");
}

export async function quoteWalletSend(params: {
  chain: LocalKeystoreWalletChain;
  accounts: readonly WalletPublicAccount[];
  accountId?: string;
  to: string;
  amount: string;
  config?: WalletConfig;
}): Promise<WalletQuote> {
  if (params.chain === "btc") {
    return quoteBtc({
      accounts: params.accounts,
      accountId: params.accountId,
      to: params.to,
      amount: params.amount,
      config: params.config?.networks?.btc,
    });
  }
  if (params.chain === "evm") {
    const account = requireAccount(params.accounts, "evm", params.accountId);
    const provider = resolveEvmProvider(params.config?.networks?.evm);
    const amountAtomic = parseEther(params.amount);
    const fee = await provider.estimateGas({
      from: account.address,
      to: params.to,
      value: amountAtomic,
    });
    const feeData = await provider.getFeeData();
    const feePrice = feeData.gasPrice ?? feeData.maxFeePerGas ?? 0n;
    const estimatedFee = fee * feePrice;
    return {
      chain: "evm",
      accountId: account.id,
      network: account.network,
      from: account.address,
      to: params.to,
      asset: params.config?.networks?.evm?.currencySymbol ?? "ETH",
      amountAtomic: amountAtomic.toString(),
      amount: formatEther(amountAtomic),
      estimatedFeeAtomic: estimatedFee.toString(),
      estimatedFee: formatEther(estimatedFee),
    };
  }
  if (params.chain === "sol") {
    const account = requireAccount(params.accounts, "sol", params.accountId);
    const amountAtomic = parseDecimalAmount(params.amount, 9);
    return {
      chain: "sol",
      accountId: account.id,
      network: account.network,
      from: account.address,
      to: params.to,
      asset: "SOL",
      amountAtomic: amountAtomic.toString(),
      amount: formatAtomicAmount(amountAtomic, 9),
      estimatedFeeAtomic: "5000",
      estimatedFee: formatAtomicAmount(5000n, 9),
    };
  }
  const account = requireAccount(params.accounts, "trx", params.accountId);
  const amountAtomic = parseDecimalAmount(params.amount, 6);
  return {
    chain: "trx",
    accountId: account.id,
    network: account.network,
    from: account.address,
    to: params.to,
    asset: "TRX",
    amountAtomic: amountAtomic.toString(),
    amount: formatAtomicAmount(amountAtomic, 6),
  };
}

export async function sendWalletTransaction(params: {
  chain: LocalKeystoreWalletChain;
  accounts: readonly WalletPublicAccount[];
  accountId?: string;
  to: string;
  amount: string;
  mnemonic: string;
  config?: WalletConfig;
}): Promise<WalletSendResult> {
  const quote = await quoteWalletSend(params);
  const material = await derivePrivateMaterial({
    mnemonic: params.mnemonic,
    chain: params.chain,
    config: params.config,
  });
  if (params.chain === "btc") {
    const btcConfig = params.config?.networks?.btc;
    const network = resolveBtcNetwork(btcConfig);
    const keyPair = ECPair.fromPrivateKey(Buffer.from(material.privateKey as Uint8Array), {
      network: network.network,
    });
    const payment = bitcoin.payments.p2wpkh({
      pubkey: Buffer.from(keyPair.publicKey),
      network: network.network,
    });
    if (!payment.output) {
      throw new Error("Unable to build Bitcoin witness output.");
    }
    const utxos = (await fetchBtcUtxos(material.address, btcConfig)).filter(
      (utxo) => utxo.status?.confirmed !== false,
    );
    const fee = BigInt(quote.estimatedFeeAtomic ?? "0");
    const target = BigInt(quote.amountAtomic);
    let selected = 0n;
    const selectedUtxos: BtcUtxo[] = [];
    for (const utxo of utxos.toSorted((a, b) => b.value - a.value)) {
      selected += BigInt(utxo.value);
      selectedUtxos.push(utxo);
      if (selected >= target + fee) {
        break;
      }
    }
    const psbt = new bitcoin.Psbt({ network: network.network });
    for (const utxo of selectedUtxos) {
      psbt.addInput({
        hash: utxo.txid,
        index: utxo.vout,
        witnessUtxo: { script: payment.output, value: BigInt(utxo.value) },
      });
    }
    psbt.addOutput({ address: params.to, value: target });
    const change = selected - target - fee;
    if (change > 546n) {
      psbt.addOutput({ address: material.address, value: change });
    }
    psbt.signAllInputs(keyPair);
    psbt.finalizeAllInputs();
    const txHex = psbt.extractTransaction().toHex();
    const txId = await fetchText(`${resolveBtcEsploraUrl(btcConfig)}/tx`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: txHex,
    });
    return { ...quote, txId: txId.trim(), explorerUrl: undefined };
  }
  if (params.chain === "evm") {
    const provider = resolveEvmProvider(params.config?.networks?.evm);
    const wallet = new EvmWallet(material.privateKey as string, provider);
    const tx = await wallet.sendTransaction({ to: params.to, value: BigInt(quote.amountAtomic) });
    return {
      ...quote,
      txId: tx.hash,
      explorerUrl: params.config?.networks?.evm?.explorerTxUrl
        ? `${params.config.networks.evm.explorerTxUrl.replace(/\/+$/, "")}/${tx.hash}`
        : undefined,
    };
  }
  if (params.chain === "sol") {
    const connection = resolveSolConnection(params.config?.networks?.sol);
    const keypair = Keypair.fromSeed(material.privateKey as Uint8Array);
    const amountAtomic = Number(BigInt(quote.amountAtomic));
    if (!Number.isSafeInteger(amountAtomic) || amountAtomic <= 0) {
      throw new Error("SOL amount is outside the supported range.");
    }
    const transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: keypair.publicKey,
        toPubkey: new PublicKey(params.to),
        lamports: amountAtomic,
      }),
    );
    const txId = await sendAndConfirmTransaction(connection, transaction, [keypair]);
    return {
      ...quote,
      txId,
      explorerUrl: params.config?.networks?.sol?.explorerTxUrl
        ? `${params.config.networks.sol.explorerTxUrl.replace(/\/+$/, "")}/${txId}`
        : undefined,
    };
  }
  const tronConfig = params.config?.networks?.trx;
  const tronWeb = resolveTronWeb(tronConfig, String(material.privateKey).replace(/^0x/, ""));
  const amountAtomic = Number(BigInt(quote.amountAtomic));
  if (!Number.isSafeInteger(amountAtomic) || amountAtomic <= 0) {
    throw new Error("TRX amount is outside the supported range.");
  }
  const raw = await tronWeb.trx.sendTransaction(params.to, amountAtomic);
  const txId = typeof raw.txid === "string" ? raw.txid : "";
  if (!txId) {
    throw new Error("TRON broadcast did not return a transaction id.");
  }
  return {
    ...quote,
    txId,
    explorerUrl: tronConfig?.explorerTxUrl
      ? `${tronConfig.explorerTxUrl.replace(/\/+$/, "")}/${txId}`
      : undefined,
    raw,
  };
}

export function isLocalKeystoreWalletChain(chain: WalletChain): chain is LocalKeystoreWalletChain {
  return (LOCAL_KEYSTORE_WALLET_CHAINS as readonly string[]).includes(chain);
}

export const SOL_LAMPORTS_PER_SOL = LAMPORTS_PER_SOL;
