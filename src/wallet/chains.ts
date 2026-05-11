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
  Contract,
  HDNodeWallet,
  JsonRpcProvider,
  Signature,
  Transaction as EvmTransaction,
  Wallet as EvmWallet,
  formatEther,
  formatUnits,
  getBytes,
  hexlify,
  parseEther,
  type TransactionRequest,
} from "ethers";
import * as ecc from "tiny-secp256k1";
import { TronWeb } from "tronweb";
import { normalizeResolvedSecretInputString } from "../config/types.secrets.js";
import type {
  WalletBtcNetworkConfig,
  WalletChain,
  WalletConfig,
  WalletEvmChainConfig,
  WalletEvmNftConfig,
  WalletEvmNftStandard,
  WalletEvmNetworkConfig,
  WalletEvmTokenConfig,
  WalletSolNetworkConfig,
  WalletTrxNetworkConfig,
} from "../config/types.wallet.js";
import { formatAtomicAmount, parseDecimalAmount } from "./amounts.js";
import {
  DEFAULT_DERIVATION_PATHS,
  LOCAL_KEYSTORE_WALLET_CHAINS,
  type LocalKeystoreWalletChain,
  type WalletBalance,
  type WalletBroadcastResult,
  type WalletNftCollection,
  type WalletNftToken,
  type WalletPrivateMaterial,
  type WalletPublicAccount,
  type WalletQuote,
  type WalletSendResult,
  type WalletSignatureResult,
  type WalletSignedRawTransaction,
  type WalletTokenBalance,
} from "./types.js";

type Ed25519HdKeyModule = {
  derivePath: (path: string, seed: string) => { key: Buffer; chainCode: Buffer };
};

const ECPair = ECPairFactory(ecc);
bitcoin.initEccLib(ecc);

const EVM_NETWORK_ID_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/;
const DEFAULT_EVM_NETWORK_ORDER = ["ethereum", "base", "monad"] as const;
const DEFAULT_EVM_NETWORK_IDS = new Set<string>(DEFAULT_EVM_NETWORK_ORDER);
const DEFAULT_EVM_NETWORKS: Record<
  (typeof DEFAULT_EVM_NETWORK_ORDER)[number],
  Required<Pick<WalletEvmChainConfig, "chainId" | "name" | "rpcUrl" | "currencySymbol">> &
    Pick<WalletEvmChainConfig, "explorerTxUrl">
> = {
  ethereum: {
    chainId: 1,
    name: "ethereum",
    rpcUrl: "https://ethereum-rpc.publicnode.com",
    currencySymbol: "ETH",
    explorerTxUrl: "https://etherscan.io/tx",
  },
  base: {
    chainId: 8453,
    name: "base",
    rpcUrl: "https://mainnet.base.org",
    currencySymbol: "ETH",
    explorerTxUrl: "https://base.blockscout.com/tx",
  },
  monad: {
    chainId: 143,
    name: "monad",
    rpcUrl: "https://rpc.monad.xyz",
    currencySymbol: "MON",
    explorerTxUrl: "https://monadscan.com/tx",
  },
};

export type ResolvedEvmNetwork = {
  id: string;
  accountId: string;
  chainId?: number;
  name: string;
  rpcUrl?: unknown;
  rpcUrlPath: string;
  currencySymbol: string;
  explorerTxUrl?: string;
  tokens: Record<string, WalletEvmTokenConfig>;
  nfts: Record<string, WalletEvmNftConfig>;
};

type StaticContractMethod<Args extends unknown[], Result> = {
  staticCall: (...args: Args) => Promise<Result>;
};

const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function name() view returns (string)",
] as const;

const ERC721_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function tokenURI(uint256 tokenId) view returns (string)",
  "function symbol() view returns (string)",
  "function name() view returns (string)",
] as const;

const ERC1155_ABI = [
  "function balanceOf(address owner, uint256 tokenId) view returns (uint256)",
  "function uri(uint256 tokenId) view returns (string)",
] as const;

function normalizeAccountId(chain: WalletChain): string {
  return `${chain}:default`;
}

function normalizeEvmAccountId(networkId: string): string {
  return `evm:${networkId}`;
}

function normalizeEvmNetworkId(id: string): string {
  const normalized = id.trim().toLowerCase();
  if (!EVM_NETWORK_ID_PATTERN.test(normalized)) {
    throw new Error(`Invalid EVM network id: ${id}`);
  }
  return normalized;
}

function normalizeEvmAssetId(id: string, label: string): string {
  const normalized = id.trim().toLowerCase();
  if (!EVM_NETWORK_ID_PATTERN.test(normalized)) {
    throw new Error(`Invalid EVM ${label} id: ${id}`);
  }
  return normalized;
}

function enabledRecord<T extends { enabled?: boolean }>(
  entries: Record<string, T> | undefined,
  label: string,
): Record<string, T> {
  const result: Record<string, T> = {};
  for (const [id, config] of Object.entries(entries ?? {})) {
    if (!enabled(config)) {
      continue;
    }
    result[normalizeEvmAssetId(id, label)] = config;
  }
  return result;
}

function evmNetworkIdFromAccountId(accountId?: string): string | undefined {
  const raw = accountId?.trim();
  if (!raw?.startsWith("evm:")) {
    return undefined;
  }
  const id = raw.slice("evm:".length);
  return id ? normalizeEvmNetworkId(id) : undefined;
}

function nowIso(): string {
  return new Date().toISOString();
}

function enabled(config: { enabled?: boolean } | undefined): boolean {
  return config?.enabled !== false;
}

function hasLegacyEvmNetworkConfig(config?: WalletEvmNetworkConfig): boolean {
  return Boolean(
    config?.chainId !== undefined ||
    config?.name ||
    config?.rpcUrl !== undefined ||
    config?.currencySymbol ||
    config?.explorerTxUrl,
  );
}

function defaultEvmNetworkForConfig(
  config: WalletEvmChainConfig,
): WalletEvmChainConfig | undefined {
  if (config.chainId !== undefined) {
    return Object.values(DEFAULT_EVM_NETWORKS).find(
      (network) => network.chainId === config.chainId,
    );
  }
  const name = config.name?.trim().toLowerCase();
  return name && DEFAULT_EVM_NETWORK_IDS.has(name)
    ? DEFAULT_EVM_NETWORKS[name as keyof typeof DEFAULT_EVM_NETWORKS]
    : undefined;
}

function withDefaultEvmRpc(config: WalletEvmChainConfig): WalletEvmChainConfig {
  if (config.rpcUrl !== undefined) {
    return config;
  }
  return { ...defaultEvmNetworkForConfig(config), ...config };
}

function resolveEvmNetwork(
  id: string,
  config: WalletEvmChainConfig,
  rpcUrlPath: string,
): ResolvedEvmNetwork | null {
  if (!enabled(config)) {
    return null;
  }
  const normalizedId = normalizeEvmNetworkId(id);
  const name = config.name?.trim() || normalizedId;
  return {
    id: normalizedId,
    accountId: normalizeEvmAccountId(normalizedId),
    chainId: config.chainId,
    name,
    rpcUrl: config.rpcUrl,
    rpcUrlPath,
    currencySymbol: config.currencySymbol?.trim() || (normalizedId === "monad" ? "MON" : "ETH"),
    explorerTxUrl: config.explorerTxUrl,
    tokens: enabledRecord(config.tokens, "token"),
    nfts: enabledRecord(config.nfts, "NFT collection"),
  };
}

export function resolveEvmNetworks(config?: WalletEvmNetworkConfig): ResolvedEvmNetwork[] {
  if (config?.enabled === false) {
    return [];
  }
  if (!config?.chains && hasLegacyEvmNetworkConfig(config)) {
    const legacy = resolveEvmNetwork(
      "default",
      withDefaultEvmRpc(config ?? {}),
      "wallet.networks.evm.rpcUrl",
    );
    return legacy ? [legacy] : [];
  }

  const configuredChains = new Map(
    Object.entries(config?.chains ?? {}).map(([id, chainConfig]) => [
      normalizeEvmNetworkId(id),
      chainConfig,
    ]),
  );
  const configuredIds = [...configuredChains.keys()]
    .filter((id) => !DEFAULT_EVM_NETWORK_IDS.has(id))
    .toSorted();
  const ids = [...DEFAULT_EVM_NETWORK_ORDER, ...configuredIds];
  const networks: ResolvedEvmNetwork[] = [];
  for (const id of ids) {
    const defaults = DEFAULT_EVM_NETWORKS[id as keyof typeof DEFAULT_EVM_NETWORKS];
    const chainConfig = configuredChains.get(id);
    const merged = withDefaultEvmRpc({ ...defaults, ...chainConfig });
    const network = resolveEvmNetwork(id, merged, `wallet.networks.evm.chains.${id}.rpcUrl`);
    if (network) {
      networks.push(network);
    }
  }
  return networks;
}

function resolveEvmNetworkForAccount(
  config: WalletEvmNetworkConfig | undefined,
  accountId: string,
): ResolvedEvmNetwork {
  const networks = resolveEvmNetworks(config);
  const requestedId = evmNetworkIdFromAccountId(accountId);
  const requested =
    requestedId === "default" && !networks.some((network) => network.id === "default")
      ? "ethereum"
      : requestedId;
  if (requested) {
    const network = networks.find((entry) => entry.id === requested);
    if (!network) {
      throw new Error(`Wallet EVM network is not enabled for account ${accountId}.`);
    }
    return network;
  }
  const network = networks[0];
  if (!network) {
    throw new Error("wallet.networks.evm has no enabled networks.");
  }
  return network;
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
  network?: ResolvedEvmNetwork,
): WalletPrivateMaterial {
  const path = resolveEvmPath(config);
  const wallet = HDNodeWallet.fromPhrase(mnemonic, undefined, path);
  return {
    chain: "evm",
    address: wallet.address,
    privateKey: wallet.privateKey,
    publicKey: wallet.publicKey ? Buffer.from(wallet.publicKey.slice(2), "hex") : undefined,
    derivationPath: path,
    network:
      network?.name ?? config?.name ?? (config?.chainId ? `chain-${config.chainId}` : "ethereum"),
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
    if (chain === "evm") {
      for (const evmNetwork of resolveEvmNetworks(params.config?.networks?.evm)) {
        const material = deriveEvmMaterial(
          assertValidWalletMnemonic(params.mnemonic),
          params.config?.networks?.evm,
          evmNetwork,
        );
        accounts.push({
          id: evmNetwork.accountId,
          chain,
          address: material.address,
          derivationPath: material.derivationPath,
          network: material.network,
          createdAt,
          updatedAt: createdAt,
        });
      }
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

function evmPublicAccountFromSource(
  source: WalletPublicAccount,
  network: ResolvedEvmNetwork,
): WalletPublicAccount {
  const account: WalletPublicAccount = {
    id: network.accountId,
    chain: source.chain,
    address: source.address,
    createdAt: source.createdAt,
    updatedAt: source.updatedAt,
    network: network.name,
  };
  if (source.label !== undefined) {
    account.label = source.label;
  }
  if (source.derivationPath !== undefined) {
    account.derivationPath = source.derivationPath;
  }
  return account;
}

export function expandEvmPublicAccounts(
  accounts: readonly WalletPublicAccount[],
  config?: WalletConfig,
): WalletPublicAccount[] {
  const evmNetworks = resolveEvmNetworks(config?.networks?.evm);
  if (evmNetworks.length <= 1) {
    return [...accounts];
  }
  const evmAccounts = accounts.filter((account) => account.chain === "evm");
  const source =
    evmAccounts.find((account) => account.id === normalizeAccountId("evm")) ?? evmAccounts[0];
  if (!source) {
    return [...accounts];
  }
  const expanded: WalletPublicAccount[] = [];
  let insertedEvmNetworks = false;
  const existingIds = new Set(accounts.map((account) => account.id));
  existingIds.delete(normalizeAccountId("evm"));
  for (const account of accounts) {
    if (account.chain === "evm" && account.id === normalizeAccountId("evm")) {
      if (!insertedEvmNetworks) {
        expanded.push(
          ...evmNetworks
            .filter((network) => !existingIds.has(network.accountId))
            .map((network) => evmPublicAccountFromSource(source, network)),
        );
        insertedEvmNetworks = true;
      }
      continue;
    }
    expanded.push(account);
  }
  if (!insertedEvmNetworks) {
    const expandedIds = new Set(expanded.map((account) => account.id));
    for (const network of evmNetworks) {
      if (!expandedIds.has(network.accountId)) {
        expanded.push(evmPublicAccountFromSource(source, network));
      }
    }
  }
  return expanded;
}

function requireAccount(
  accounts: readonly WalletPublicAccount[],
  chain: WalletChain,
  accountId?: string,
): WalletPublicAccount {
  const id = accountId?.trim();
  if (id) {
    const candidateIds =
      chain === "evm" && id === normalizeAccountId(chain)
        ? [id, normalizeEvmAccountId("ethereum")]
        : [id];
    const account = candidateIds
      .map((candidateId) =>
        accounts.find((entry) => entry.id === candidateId && entry.chain === chain),
      )
      .find((entry): entry is WalletPublicAccount => Boolean(entry));
    if (!account) {
      throw new Error(`Wallet account not found for ${chain}: ${id}`);
    }
    return account;
  }
  const defaultIds =
    chain === "evm" ? [normalizeEvmAccountId("ethereum"), normalizeAccountId(chain)] : [];
  const candidateIds = [...defaultIds, normalizeAccountId(chain)];
  const account =
    candidateIds
      .map((candidateId) =>
        accounts.find((entry) => entry.id === candidateId && entry.chain === chain),
      )
      .find((entry): entry is WalletPublicAccount => Boolean(entry)) ??
    accounts.find((entry) => entry.chain === chain);
  if (!account) {
    throw new Error(`Wallet account not found for ${chain}: ${id ?? normalizeAccountId(chain)}`);
  }
  return account;
}

function resolveEvmProvider(network: ResolvedEvmNetwork): JsonRpcProvider {
  const rpcUrl = resolveSecretString(network.rpcUrl, network.rpcUrlPath);
  if (!rpcUrl) {
    throw new Error(`${network.rpcUrlPath} is required for EVM balance and send.`);
  }
  return new JsonRpcProvider(rpcUrl, network.chainId);
}

function contractMethod<Args extends unknown[], Result>(
  contract: Contract,
  name: string,
): StaticContractMethod<Args, Result> {
  return contract.getFunction(name) as unknown as StaticContractMethod<Args, Result>;
}

function normalizeEvmAddress(address: string): string {
  return address.trim().toLowerCase();
}

function parseContractUint(value: unknown, label: string): bigint {
  if (typeof value === "bigint") {
    if (value < 0n) {
      throw new Error(`${label} returned a negative value.`);
    }
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`${label} returned an unsafe numeric value.`);
    }
    return BigInt(value);
  }
  if (typeof value === "string" && /^(0x[0-9a-fA-F]+|[0-9]+)$/.test(value.trim())) {
    return BigInt(value.trim());
  }
  throw new Error(`${label} returned an unsupported value.`);
}

function parseContractNumber(value: unknown, label: string): number {
  const parsed = parseContractUint(value, label);
  if (parsed > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`${label} returned a value outside the supported range.`);
  }
  return Number(parsed);
}

function parseContractString(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`${label} returned an unsupported value.`);
  }
  return value;
}

async function readOptionalContractString(
  contract: Contract,
  methodName: string,
): Promise<string | undefined> {
  try {
    const value = await contractMethod<[], unknown>(contract, methodName).staticCall();
    const normalized = parseContractString(value, methodName).trim();
    return normalized || undefined;
  } catch {
    return undefined;
  }
}

async function resolveErc20Decimals(
  contract: Contract,
  config: WalletEvmTokenConfig,
  tokenId: string,
): Promise<number> {
  if (config.decimals !== undefined) {
    if (!Number.isInteger(config.decimals) || config.decimals < 0 || config.decimals > 255) {
      throw new Error(`wallet EVM token ${tokenId} decimals must be between 0 and 255.`);
    }
    return config.decimals;
  }
  const value = await contractMethod<[], unknown>(contract, "decimals").staticCall();
  const decimals = parseContractNumber(value, "decimals");
  if (decimals < 0 || decimals > 255) {
    throw new Error(`wallet EVM token ${tokenId} decimals must be between 0 and 255.`);
  }
  return decimals;
}

function selectEvmAccounts(
  accounts: readonly WalletPublicAccount[],
  accountId?: string,
): WalletPublicAccount[] {
  if (accountId?.trim()) {
    return [requireAccount(accounts, "evm", accountId)];
  }
  return accounts.filter((account) => account.chain === "evm");
}

export async function getWalletTokenBalances(params: {
  accounts: readonly WalletPublicAccount[];
  accountId?: string;
  config?: WalletConfig;
}): Promise<WalletTokenBalance[]> {
  const balances: WalletTokenBalance[] = [];
  for (const account of selectEvmAccounts(params.accounts, params.accountId)) {
    const evmNetwork = resolveEvmNetworkForAccount(params.config?.networks?.evm, account.id);
    const tokenEntries = Object.entries(evmNetwork.tokens);
    if (tokenEntries.length === 0) {
      continue;
    }
    const provider = resolveEvmProvider(evmNetwork);
    for (const [tokenId, tokenConfig] of tokenEntries) {
      const contract = new Contract(tokenConfig.address, ERC20_ABI, provider);
      const amountAtomic = parseContractUint(
        await contractMethod<[string], unknown>(contract, "balanceOf").staticCall(account.address),
        `EVM token ${tokenId} balanceOf`,
      );
      const decimals = await resolveErc20Decimals(contract, tokenConfig, tokenId);
      const symbol =
        tokenConfig.symbol?.trim() ||
        (await readOptionalContractString(contract, "symbol")) ||
        tokenId.toUpperCase();
      const name = tokenConfig.name?.trim() || (await readOptionalContractString(contract, "name"));
      balances.push({
        chain: "evm",
        accountId: account.id,
        address: account.address,
        network: evmNetwork.name,
        tokenId,
        contractAddress: tokenConfig.address,
        asset: symbol,
        ...(name ? { name } : {}),
        decimals,
        amountAtomic: amountAtomic.toString(),
        amount: formatUnits(amountAtomic, decimals),
      });
    }
  }
  return balances;
}

async function readErc721Token(
  contract: Contract,
  account: WalletPublicAccount,
  tokenId: string,
): Promise<WalletNftToken | null> {
  const owner = parseContractString(
    await contractMethod<[string], unknown>(contract, "ownerOf").staticCall(tokenId),
    `ERC-721 token ${tokenId} ownerOf`,
  );
  if (normalizeEvmAddress(owner) !== normalizeEvmAddress(account.address)) {
    return null;
  }
  const tokenUri = await readOptionalTokenUri(contract, tokenId, "tokenURI");
  return {
    tokenId,
    amount: "1",
    ...(tokenUri ? { tokenUri } : {}),
  };
}

async function readErc1155Token(
  contract: Contract,
  account: WalletPublicAccount,
  tokenId: string,
): Promise<WalletNftToken | null> {
  const amount = parseContractUint(
    await contractMethod<[string, string], unknown>(contract, "balanceOf").staticCall(
      account.address,
      tokenId,
    ),
    `ERC-1155 token ${tokenId} balanceOf`,
  );
  if (amount === 0n) {
    return null;
  }
  const tokenUri = await readOptionalTokenUri(contract, tokenId, "uri");
  return {
    tokenId,
    amount: amount.toString(),
    ...(tokenUri ? { tokenUri } : {}),
  };
}

async function readOptionalTokenUri(
  contract: Contract,
  tokenId: string,
  methodName: "tokenURI" | "uri",
): Promise<string | undefined> {
  try {
    const value = await contractMethod<[string], unknown>(contract, methodName).staticCall(tokenId);
    const normalized = parseContractString(value, methodName).trim();
    return normalized || undefined;
  } catch {
    return undefined;
  }
}

function nftAbiForStandard(standard: WalletEvmNftStandard): readonly string[] {
  return standard === "erc1155" ? ERC1155_ABI : ERC721_ABI;
}

async function readNftCollectionBalance(params: {
  contract: Contract;
  account: WalletPublicAccount;
  standard: WalletEvmNftStandard;
  tokens: readonly WalletNftToken[];
}): Promise<string | undefined> {
  if (params.standard === "erc721") {
    const balance = parseContractUint(
      await contractMethod<[string], unknown>(params.contract, "balanceOf").staticCall(
        params.account.address,
      ),
      "ERC-721 balanceOf",
    );
    return balance.toString();
  }
  if (params.tokens.length === 0) {
    return undefined;
  }
  return params.tokens.reduce((sum, token) => sum + BigInt(token.amount ?? "0"), 0n).toString();
}

export async function getWalletNftCollections(params: {
  accounts: readonly WalletPublicAccount[];
  accountId?: string;
  config?: WalletConfig;
}): Promise<WalletNftCollection[]> {
  const collections: WalletNftCollection[] = [];
  for (const account of selectEvmAccounts(params.accounts, params.accountId)) {
    const evmNetwork = resolveEvmNetworkForAccount(params.config?.networks?.evm, account.id);
    const nftEntries = Object.entries(evmNetwork.nfts);
    if (nftEntries.length === 0) {
      continue;
    }
    const provider = resolveEvmProvider(evmNetwork);
    for (const [collectionId, nftConfig] of nftEntries) {
      const standard = nftConfig.standard ?? "erc721";
      const contract = new Contract(nftConfig.address, nftAbiForStandard(standard), provider);
      const tokens: WalletNftToken[] = [];
      for (const tokenId of nftConfig.tokenIds ?? []) {
        const token =
          standard === "erc1155"
            ? await readErc1155Token(contract, account, tokenId)
            : await readErc721Token(contract, account, tokenId);
        if (token) {
          tokens.push(token);
        }
      }
      const balance = await readNftCollectionBalance({
        contract,
        account,
        standard,
        tokens,
      });
      const name = nftConfig.name?.trim() || (await readOptionalContractString(contract, "name"));
      const symbol =
        standard === "erc721"
          ? nftConfig.symbol?.trim() || (await readOptionalContractString(contract, "symbol"))
          : nftConfig.symbol?.trim();
      collections.push({
        chain: "evm",
        accountId: account.id,
        address: account.address,
        network: evmNetwork.name,
        collectionId,
        contractAddress: nftConfig.address,
        standard,
        ...(name ? { name } : {}),
        ...(symbol ? { symbol } : {}),
        ...(balance !== undefined ? { balance } : {}),
        tokens,
      });
    }
  }
  return collections;
}

function unsupportedLowLevelSigningChain(chain: LocalKeystoreWalletChain): never {
  throw new Error(`Wallet low-level signing currently supports EVM only, not ${chain}.`);
}

function requireEvmLowLevelSigningChain(chain: LocalKeystoreWalletChain): asserts chain is "evm" {
  if (chain !== "evm") {
    unsupportedLowLevelSigningChain(chain);
  }
}

function normalizeHexValue(
  value: string,
  label: string,
  options: { byteLength?: number; allowEmpty?: boolean } = {},
): string {
  const normalized = value.trim().toLowerCase();
  if (!/^0x[0-9a-f]*$/.test(normalized)) {
    throw new Error(`${label} must be a 0x-prefixed hex string.`);
  }
  if (!options.allowEmpty && normalized.length === 2) {
    throw new Error(`${label} must not be empty.`);
  }
  if (normalized.length % 2 !== 0) {
    throw new Error(`${label} must contain full bytes.`);
  }
  if (options.byteLength !== undefined && normalized.length !== 2 + options.byteLength * 2) {
    throw new Error(`${label} must be ${options.byteLength} bytes.`);
  }
  return normalized;
}

function parseIntegerString(value: string, label: string): bigint {
  const normalized = value.trim();
  if (!/^(0x[0-9a-fA-F]+|[0-9]+)$/.test(normalized)) {
    throw new Error(`${label} must be a non-negative integer or 0x-prefixed integer.`);
  }
  return BigInt(normalized);
}

function parseBigNumberish(value: unknown, label: string): string | number | bigint | null {
  if (value === null) {
    return null;
  }
  if (typeof value === "string") {
    const parsed = parseIntegerString(value, label);
    return value.trim().startsWith("0x") ? `0x${parsed.toString(16)}` : parsed.toString(10);
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`${label} must be a non-negative safe integer.`);
    }
    return value;
  }
  if (typeof value === "bigint") {
    if (value < 0n) {
      throw new Error(`${label} must be non-negative.`);
    }
    return value;
  }
  throw new Error(`${label} must be a non-negative integer.`);
}

function parseNumberish(value: unknown, label: string): number | null {
  if (value === null) {
    return null;
  }
  const parsed =
    typeof value === "string"
      ? parseIntegerString(value, label)
      : typeof value === "number" && Number.isSafeInteger(value) && value >= 0
        ? BigInt(value)
        : null;
  if (parsed === null) {
    throw new Error(`${label} must be a non-negative safe integer.`);
  }
  if (parsed > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`${label} is outside the supported integer range.`);
  }
  return Number(parsed);
}

function parseHexData(value: unknown, label: string): string | null {
  if (value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new Error(`${label} must be a 0x-prefixed hex string.`);
  }
  return normalizeHexValue(value, label, { allowEmpty: true });
}

function parseAddressLike(value: unknown, label: string): string | null {
  if (value === null) {
    return null;
  }
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} must be an address string.`);
  }
  return value.trim();
}

function bigintFromNumberish(value: TransactionRequest["chainId"]): bigint | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === "bigint") {
    return value;
  }
  if (typeof value === "number") {
    return BigInt(value);
  }
  if (typeof value === "string") {
    return parseIntegerString(value, "chainId");
  }
  return undefined;
}

function createEvmTransactionRequest(
  input: Record<string, unknown>,
  network: ResolvedEvmNetwork,
  fromAddress: string,
): TransactionRequest {
  const allowedFields = new Set([
    "accessList",
    "chainId",
    "customData",
    "data",
    "from",
    "gas",
    "gasLimit",
    "gasPrice",
    "maxFeePerGas",
    "maxPriorityFeePerGas",
    "nonce",
    "to",
    "type",
    "value",
  ]);
  for (const field of Object.keys(input)) {
    if (!allowedFields.has(field)) {
      throw new Error(`Unsupported EVM transaction field: ${field}`);
    }
  }

  const request: TransactionRequest = {};
  if ("type" in input) {
    request.type = parseNumberish(input.type, "type");
  }
  if ("to" in input) {
    request.to = parseAddressLike(input.to, "to");
  }
  if ("from" in input) {
    request.from = parseAddressLike(input.from, "from");
  } else {
    request.from = fromAddress;
  }
  if ("nonce" in input) {
    request.nonce = parseNumberish(input.nonce, "nonce");
  }
  const gasLimit = input.gasLimit ?? input.gas;
  if (gasLimit !== undefined) {
    request.gasLimit = parseBigNumberish(gasLimit, "gasLimit");
  }
  if ("gasPrice" in input) {
    request.gasPrice = parseBigNumberish(input.gasPrice, "gasPrice");
  }
  if ("maxPriorityFeePerGas" in input) {
    request.maxPriorityFeePerGas = parseBigNumberish(
      input.maxPriorityFeePerGas,
      "maxPriorityFeePerGas",
    );
  }
  if ("maxFeePerGas" in input) {
    request.maxFeePerGas = parseBigNumberish(input.maxFeePerGas, "maxFeePerGas");
  }
  if ("data" in input) {
    request.data = parseHexData(input.data, "data");
  }
  if ("value" in input) {
    request.value = parseBigNumberish(input.value, "value");
  }
  if ("chainId" in input) {
    request.chainId = parseBigNumberish(input.chainId, "chainId");
  } else if (network.chainId !== undefined) {
    request.chainId = network.chainId;
  }
  if ("accessList" in input) {
    request.accessList = input.accessList as TransactionRequest["accessList"];
  }
  if ("customData" in input) {
    request.customData = input.customData;
  }

  const expectedChainId = network.chainId === undefined ? undefined : BigInt(network.chainId);
  const requestChainId = bigintFromNumberish(request.chainId);
  if (
    expectedChainId !== undefined &&
    requestChainId !== undefined &&
    requestChainId !== expectedChainId
  ) {
    throw new Error(
      `EVM transaction chainId ${requestChainId.toString()} does not match ${network.name} (${expectedChainId.toString()}).`,
    );
  }
  return request;
}

function resolveEvmSigningContext(params: {
  accounts: readonly WalletPublicAccount[];
  accountId?: string;
  mnemonic: string;
  config?: WalletConfig;
}) {
  const account = requireAccount(params.accounts, "evm", params.accountId);
  const evmNetwork = resolveEvmNetworkForAccount(params.config?.networks?.evm, account.id);
  const material = deriveEvmMaterial(
    assertValidWalletMnemonic(params.mnemonic),
    params.config?.networks?.evm,
    evmNetwork,
  );
  const wallet = new EvmWallet(material.privateKey as string);
  return { account, evmNetwork, wallet };
}

function formatEvmSignatureResult(params: {
  account: WalletPublicAccount;
  network: ResolvedEvmNetwork;
  payloadKind: "message" | "message-hex" | "digest";
  signature: string;
  digest?: string;
  messageHex?: string;
}): WalletSignatureResult {
  const parsed = Signature.from(params.signature);
  return {
    chain: "evm",
    accountId: params.account.id,
    address: params.account.address,
    network: params.network.name,
    payloadKind: params.payloadKind,
    signature: parsed.serialized,
    r: parsed.r,
    s: parsed.s,
    v: parsed.v,
    yParity: parsed.yParity,
    ...(params.digest !== undefined ? { digest: params.digest } : {}),
    ...(params.messageHex !== undefined ? { messageHex: params.messageHex } : {}),
  };
}

export async function signWalletMessagePayload(params: {
  chain: LocalKeystoreWalletChain;
  accounts: readonly WalletPublicAccount[];
  accountId?: string;
  mnemonic: string;
  message?: string;
  messageHex?: string;
  config?: WalletConfig;
}): Promise<WalletSignatureResult> {
  requireEvmLowLevelSigningChain(params.chain);
  const hasMessage = params.message !== undefined;
  const hasMessageHex = params.messageHex !== undefined;
  if (hasMessage === hasMessageHex) {
    throw new Error("Provide exactly one of message or messageHex.");
  }
  const { account, evmNetwork, wallet } = resolveEvmSigningContext(params);
  if (hasMessageHex) {
    const messageHex = normalizeHexValue(params.messageHex ?? "", "messageHex", {
      allowEmpty: true,
    });
    const signature = await wallet.signMessage(getBytes(messageHex));
    return formatEvmSignatureResult({
      account,
      network: evmNetwork,
      payloadKind: "message-hex",
      signature,
      messageHex: hexlify(getBytes(messageHex)),
    });
  }
  const signature = await wallet.signMessage(params.message ?? "");
  return formatEvmSignatureResult({
    account,
    network: evmNetwork,
    payloadKind: "message",
    signature,
  });
}

export async function signWalletDigestPayload(params: {
  chain: LocalKeystoreWalletChain;
  accounts: readonly WalletPublicAccount[];
  accountId?: string;
  mnemonic: string;
  digest: string;
  config?: WalletConfig;
}): Promise<WalletSignatureResult> {
  requireEvmLowLevelSigningChain(params.chain);
  const { account, evmNetwork, wallet } = resolveEvmSigningContext(params);
  const digest = normalizeHexValue(params.digest, "digest", { byteLength: 32 });
  const signature = wallet.signingKey.sign(digest).serialized;
  return formatEvmSignatureResult({
    account,
    network: evmNetwork,
    payloadKind: "digest",
    signature,
    digest,
  });
}

export async function signWalletRawTransactionPayload(params: {
  chain: LocalKeystoreWalletChain;
  accounts: readonly WalletPublicAccount[];
  accountId?: string;
  mnemonic: string;
  transaction: Record<string, unknown>;
  config?: WalletConfig;
}): Promise<WalletSignedRawTransaction> {
  requireEvmLowLevelSigningChain(params.chain);
  const { account, evmNetwork, wallet } = resolveEvmSigningContext(params);
  const request = createEvmTransactionRequest(params.transaction, evmNetwork, account.address);
  const rawTransaction = await wallet.signTransaction(request);
  const parsed = EvmTransaction.from(rawTransaction);
  return {
    chain: "evm",
    accountId: account.id,
    address: account.address,
    network: evmNetwork.name,
    rawTransaction,
    ...(parsed.hash ? { txId: parsed.hash } : {}),
  };
}

export async function broadcastWalletRawTransactionPayload(params: {
  chain: LocalKeystoreWalletChain;
  accounts: readonly WalletPublicAccount[];
  accountId?: string;
  rawTransaction: string;
  config?: WalletConfig;
}): Promise<WalletBroadcastResult> {
  requireEvmLowLevelSigningChain(params.chain);
  const account = requireAccount(params.accounts, "evm", params.accountId);
  const evmNetwork = resolveEvmNetworkForAccount(params.config?.networks?.evm, account.id);
  const provider = resolveEvmProvider(evmNetwork);
  const response = await provider.broadcastTransaction(
    normalizeHexValue(params.rawTransaction, "rawTransaction"),
  );
  return {
    chain: "evm",
    accountId: account.id,
    address: account.address,
    network: evmNetwork.name,
    txId: response.hash,
  };
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
    const evmNetwork = resolveEvmNetworkForAccount(params.config?.networks?.evm, account.id);
    const provider = resolveEvmProvider(evmNetwork);
    const balance = await provider.getBalance(account.address);
    return {
      chain: "evm",
      accountId: account.id,
      address: account.address,
      network: evmNetwork.name,
      asset: evmNetwork.currencySymbol,
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
    const evmNetwork = resolveEvmNetworkForAccount(params.config?.networks?.evm, account.id);
    const provider = resolveEvmProvider(evmNetwork);
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
      network: evmNetwork.name,
      from: account.address,
      to: params.to,
      asset: evmNetwork.currencySymbol,
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
    const account = requireAccount(params.accounts, "evm", params.accountId);
    const evmNetwork = resolveEvmNetworkForAccount(params.config?.networks?.evm, account.id);
    const provider = resolveEvmProvider(evmNetwork);
    const wallet = new EvmWallet(material.privateKey as string, provider);
    const tx = await wallet.sendTransaction({ to: params.to, value: BigInt(quote.amountAtomic) });
    return {
      ...quote,
      txId: tx.hash,
      explorerUrl: evmNetwork.explorerTxUrl
        ? `${evmNetwork.explorerTxUrl.replace(/\/+$/, "")}/${tx.hash}`
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
