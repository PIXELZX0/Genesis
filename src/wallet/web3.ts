import { randomUUID, createPrivateKey, sign as signEd25519 } from "node:crypto";
import {
  Keypair,
  PublicKey,
  VersionedTransaction,
  type SendOptions,
  type VersionedMessage,
} from "@solana/web3.js";
import { Wallet as EvmWallet, getAddress, getBytes, isHexString, toUtf8String } from "ethers";
import { loadConfig } from "../config/config.js";
import type { WalletConfig } from "../config/types.wallet.js";
import { compareDecimalAmounts, formatAtomicAmount } from "./amounts.js";
import {
  createEvmTransactionRequest,
  derivePrivateMaterial,
  resolveEvmNetworks,
  resolveEvmProvider,
  resolveSolConnection,
  type ResolvedEvmNetwork,
} from "./chains.js";
import { getWalletAccounts } from "./service.js";
import { requireWalletSessionMnemonic } from "./session.js";

export const WALLET_WEB3_APPROVAL_TIMEOUT_MS = 5 * 60 * 1000;
const WALLET_WEB3_MAX_PENDING = 32;

export type WalletWeb3Chain = "evm" | "sol";

export type WalletWeb3Request = {
  chain: WalletWeb3Chain;
  /** Origin of the calling frame, resolved by the browser host (never by page JS). */
  origin: string;
  method: string;
  params?: unknown;
  /** EVM only: the page provider's currently selected chain id (hex). */
  chainId?: string;
};

export type WalletWeb3PendingRequest = {
  id: string;
  chain: WalletWeb3Chain;
  origin: string;
  method: string;
  network?: string;
  summary: string;
  details: Record<string, unknown>;
  createdAt: number;
  expiresAt: number;
};

/** EIP-1193 style error; `code` is forwarded to the page provider. */
export class WalletWeb3Error extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
    this.name = "WalletWeb3Error";
  }
}

const USER_REJECTED = 4001;
const UNAUTHORIZED = 4100;
const UNSUPPORTED_METHOD = 4200;
const UNRECOGNIZED_CHAIN = 4902;
const INVALID_PARAMS = -32602;

type PendingEntry = {
  request: WalletWeb3PendingRequest;
  execute: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  executing: boolean;
};

// Live mutable state shared by the browser binding (plugin-sdk facade) and the
// agent wallet tool; keep it on a direct globalThis symbol across split chunks.
const PENDING_KEY = Symbol.for("genesis.wallet.web3.pending");

function pendingStore(): Map<string, PendingEntry> {
  const store = globalThis as Record<PropertyKey, unknown>;
  let pending = store[PENDING_KEY] as Map<string, PendingEntry> | undefined;
  if (!pending) {
    pending = new Map();
    store[PENDING_KEY] = pending;
  }
  return pending;
}

export function isWalletBrowserProviderEnabled(config?: WalletConfig): boolean {
  const wallet = config ?? loadConfig().wallet;
  return wallet?.enabled !== false && wallet?.browser?.enabled === true;
}

export type WalletBrowserProviderConfig = {
  enabled: boolean;
  allowedOrigins: string[];
};

/** What a browser host needs to decide whether/where to inject the provider. */
export function getWalletBrowserProviderConfig(): WalletBrowserProviderConfig {
  const config = loadConfig().wallet;
  return {
    enabled: isWalletBrowserProviderEnabled(config),
    allowedOrigins: (config?.browser?.allowedOrigins ?? []).map((entry) => new URL(entry).origin),
  };
}

function assertOriginAllowed(config: WalletConfig | undefined, origin: string) {
  if (!isWalletBrowserProviderEnabled(config)) {
    throw new WalletWeb3Error(UNAUTHORIZED, "Genesis web3 provider is disabled.");
  }
  const allowed = config?.browser?.allowedOrigins;
  if (allowed?.length && !allowed.some((entry) => new URL(entry).origin === origin)) {
    throw new WalletWeb3Error(UNAUTHORIZED, `Origin ${origin} is not allowed by wallet.browser.`);
  }
}

function assertBrowserSpendingEnabled(config: WalletConfig | undefined) {
  if (config?.spending?.enabled !== true) {
    throw new WalletWeb3Error(
      UNAUTHORIZED,
      "Wallet spending is disabled. Set wallet.spending.enabled: true.",
    );
  }
}

function queueApproval(params: {
  request: WalletWeb3Request;
  network?: string;
  summary: string;
  details: Record<string, unknown>;
  execute: () => Promise<unknown>;
}): Promise<unknown> {
  const pending = pendingStore();
  if (pending.size >= WALLET_WEB3_MAX_PENDING) {
    throw new WalletWeb3Error(USER_REJECTED, "Too many pending wallet requests.");
  }
  const id = randomUUID();
  const createdAt = Date.now();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new WalletWeb3Error(USER_REJECTED, "Wallet request timed out waiting for approval."));
    }, WALLET_WEB3_APPROVAL_TIMEOUT_MS);
    timer.unref?.();
    pending.set(id, {
      request: {
        id,
        chain: params.request.chain,
        origin: params.request.origin,
        method: params.request.method,
        ...(params.network ? { network: params.network } : {}),
        summary: params.summary,
        details: params.details,
        createdAt,
        expiresAt: createdAt + WALLET_WEB3_APPROVAL_TIMEOUT_MS,
      },
      execute: params.execute,
      resolve,
      reject,
      timer,
      executing: false,
    });
  });
}

export function listWalletWeb3PendingRequests(): WalletWeb3PendingRequest[] {
  return [...pendingStore().values()]
    .map((entry) => entry.request)
    .toSorted((a, b) => a.createdAt - b.createdAt);
}

function takePending(id: string): PendingEntry {
  const entry = pendingStore().get(id);
  if (!entry) {
    throw new Error(`No pending wallet request: ${id}`);
  }
  return entry;
}

/**
 * Signs/sends the queued request and resolves the page promise. A failed
 * execution (locked wallet, RPC error) leaves the request pending so the agent
 * can retry or reject it.
 */
export async function approveWalletWeb3Request(
  id: string,
): Promise<{ id: string; result: unknown }> {
  const entry = takePending(id);
  if (entry.executing) {
    throw new Error(`Wallet request ${id} is already being approved.`);
  }
  entry.executing = true;
  let result: unknown;
  try {
    result = await entry.execute();
  } catch (error) {
    entry.executing = false;
    throw error;
  }
  pendingStore().delete(id);
  clearTimeout(entry.timer);
  entry.resolve(result);
  return { id, result };
}

export function rejectWalletWeb3Request(id: string, reason?: string): { id: string } {
  const entry = takePending(id);
  pendingStore().delete(id);
  clearTimeout(entry.timer);
  entry.reject(new WalletWeb3Error(USER_REJECTED, reason?.trim() || "User rejected the request."));
  return { id };
}

async function requireChainAddress(config: WalletConfig | undefined, chain: WalletWeb3Chain) {
  const accounts = await getWalletAccounts({ config });
  const account = accounts.find((entry) => entry.chain === chain);
  if (!account) {
    throw new WalletWeb3Error(UNAUTHORIZED, `No ${chain} wallet account. Run genesis wallet init.`);
  }
  return account.address;
}

// ---------------------------------------------------------------------------
// EVM (EIP-1193)

const EVM_PASSTHROUGH_PREFIX = /^(eth|net|web3)_/;
const EVM_UNSUPPORTED = new Set([
  "eth_sign",
  "eth_signTransaction",
  "eth_subscribe",
  "eth_unsubscribe",
  "eth_signTypedData",
]);

function toHexChainId(chainId: number): string {
  return `0x${chainId.toString(16)}`;
}

function evmNetworks(config: WalletConfig | undefined): ResolvedEvmNetwork[] {
  return resolveEvmNetworks(config?.networks?.evm).filter(
    (network) => network.chainId !== undefined,
  );
}

function findEvmNetwork(config: WalletConfig | undefined, chainId: unknown) {
  const networks = evmNetworks(config);
  if (chainId === undefined || chainId === null || chainId === "") {
    const first = networks[0];
    if (!first) {
      throw new WalletWeb3Error(UNRECOGNIZED_CHAIN, "wallet.networks.evm has no enabled networks.");
    }
    return first;
  }
  let numeric: number;
  try {
    numeric = Number(BigInt(String(chainId)));
  } catch {
    throw new WalletWeb3Error(INVALID_PARAMS, `Invalid chainId: ${String(chainId)}`);
  }
  const network = networks.find((entry) => entry.chainId === numeric);
  if (!network) {
    throw new WalletWeb3Error(
      UNRECOGNIZED_CHAIN,
      `Chain ${String(chainId)} is not configured in wallet.networks.evm.chains.`,
    );
  }
  return network;
}

function paramsArray(params: unknown): unknown[] {
  if (params === undefined || params === null) {
    return [];
  }
  if (!Array.isArray(params)) {
    throw new WalletWeb3Error(INVALID_PARAMS, "params must be an array.");
  }
  return params;
}

function assertOwnAddress(value: unknown, address: string) {
  if (typeof value !== "string" || getAddress(value) !== getAddress(address)) {
    throw new WalletWeb3Error(UNAUTHORIZED, "Requested address is not the Genesis wallet account.");
  }
}

async function evmSigner(config: WalletConfig | undefined, network: ResolvedEvmNetwork) {
  const mnemonic = requireWalletSessionMnemonic();
  const material = await derivePrivateMaterial({ mnemonic, chain: "evm", config });
  return new EvmWallet(material.privateKey as string, resolveEvmProvider(network));
}

const EVM_TX_FIELDS = [
  "accessList",
  "chainId",
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
] as const;

function pickEvmTransaction(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new WalletWeb3Error(INVALID_PARAMS, "eth_sendTransaction expects a transaction object.");
  }
  const input = value as Record<string, unknown>;
  const picked: Record<string, unknown> = {};
  for (const field of EVM_TX_FIELDS) {
    if (input[field] !== undefined && input[field] !== null) {
      picked[field] = input[field];
    }
  }
  if (picked.data === undefined && typeof input.input === "string") {
    picked.data = input.input;
  }
  return picked;
}

function decodePersonalMessage(value: unknown): { bytes: Uint8Array | string; preview: string } {
  if (typeof value !== "string") {
    throw new WalletWeb3Error(INVALID_PARAMS, "personal_sign expects a message string.");
  }
  if (!isHexString(value)) {
    return { bytes: value, preview: value };
  }
  const bytes = getBytes(value);
  try {
    return { bytes, preview: toUtf8String(bytes) };
  } catch {
    return { bytes, preview: value };
  }
}

async function handleEvmRequest(
  config: WalletConfig | undefined,
  request: WalletWeb3Request,
): Promise<unknown> {
  const network = findEvmNetwork(config, request.chainId);
  const chainIdHex = toHexChainId(network.chainId as number);
  const params = paramsArray(request.params);
  switch (request.method) {
    case "genesis_providerState": {
      return { chainId: chainIdHex, accounts: [await requireChainAddress(config, "evm")] };
    }
    case "eth_chainId":
      return chainIdHex;
    case "net_version":
      return String(network.chainId);
    case "eth_accounts":
    case "eth_requestAccounts":
      return [await requireChainAddress(config, "evm")];
    case "wallet_requestPermissions":
    case "wallet_getPermissions":
      return [{ parentCapability: "eth_accounts", invoker: request.origin, caveats: [] }];
    case "wallet_switchEthereumChain":
    case "wallet_addEthereumChain": {
      const target = findEvmNetwork(config, (params[0] as { chainId?: unknown })?.chainId);
      return { chainId: toHexChainId(target.chainId as number) };
    }
    case "personal_sign": {
      const address = await requireChainAddress(config, "evm");
      assertOwnAddress(params[1], address);
      const message = decodePersonalMessage(params[0]);
      return queueApproval({
        request,
        network: network.name,
        summary: `Sign message: ${message.preview.slice(0, 200)}`,
        details: { address, message: message.preview },
        execute: async () => (await evmSigner(config, network)).signMessage(message.bytes),
      });
    }
    case "eth_signTypedData_v3":
    case "eth_signTypedData_v4": {
      const address = await requireChainAddress(config, "evm");
      assertOwnAddress(params[0], address);
      const typed = (typeof params[1] === "string" ? JSON.parse(params[1]) : params[1]) as {
        domain?: Record<string, unknown>;
        types?: Record<string, Array<{ name: string; type: string }>>;
        primaryType?: string;
        message?: Record<string, unknown>;
      };
      if (!typed?.types || !typed.message) {
        throw new WalletWeb3Error(INVALID_PARAMS, "Typed data requires types and message.");
      }
      const { EIP712Domain: _domain, ...types } = typed.types;
      const domainName = typeof typed.domain?.name === "string" ? typed.domain.name : "unknown";
      return queueApproval({
        request,
        network: network.name,
        summary: `Sign typed data ${typed.primaryType ?? ""} for ${domainName}`.trim(),
        details: {
          address,
          domain: typed.domain,
          primaryType: typed.primaryType,
          message: typed.message,
        },
        execute: async () =>
          (await evmSigner(config, network)).signTypedData(
            typed.domain ?? {},
            types,
            typed.message ?? {},
          ),
      });
    }
    case "eth_sendTransaction": {
      assertBrowserSpendingEnabled(config);
      const address = await requireChainAddress(config, "evm");
      const input = pickEvmTransaction(params[0]);
      if (input.from !== undefined) {
        assertOwnAddress(input.from, address);
      }
      const txRequest = createEvmTransactionRequest(input, network, address);
      const valueAtomic = txRequest.value == null ? 0n : BigInt(txRequest.value);
      const value = formatAtomicAmount(valueAtomic, 18);
      const max = config?.spending?.maxNativeAmount;
      if (max && compareDecimalAmounts(value, max, 18) > 0) {
        throw new WalletWeb3Error(
          UNAUTHORIZED,
          `Transaction value exceeds wallet.spending.maxNativeAmount (${max}).`,
        );
      }
      const data = typeof txRequest.data === "string" ? txRequest.data : "0x";
      return queueApproval({
        request,
        network: network.name,
        summary: `Send transaction to ${String(txRequest.to ?? "(contract creation)")} value ${value} ${network.currencySymbol}${data.length > 2 ? ` calldata ${data.slice(0, 10)}… (${(data.length - 2) / 2} bytes)` : ""}`,
        details: {
          from: address,
          to: txRequest.to,
          value,
          currency: network.currencySymbol,
          data,
        },
        execute: async () => {
          const response = await (await evmSigner(config, network)).sendTransaction(txRequest);
          return response.hash;
        },
      });
    }
    default:
      break;
  }
  if (EVM_UNSUPPORTED.has(request.method) || !EVM_PASSTHROUGH_PREFIX.test(request.method)) {
    throw new WalletWeb3Error(UNSUPPORTED_METHOD, `Unsupported method: ${request.method}`);
  }
  // Read-only JSON-RPC (eth_call, eth_getBalance, eth_estimateGas, ...) goes to the configured RPC.
  return resolveEvmProvider(network).send(request.method, params);
}

// ---------------------------------------------------------------------------
// Solana (Wallet Standard / window.solana)

// PKCS#8 DER prefix for a raw 32-byte Ed25519 seed.
const ED25519_PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

function solChain(config: WalletConfig | undefined): string {
  const network = config?.networks?.sol?.network ?? "mainnet-beta";
  return network === "mainnet-beta" ? "solana:mainnet" : `solana:${network}`;
}

async function solSeed(config: WalletConfig | undefined): Promise<Uint8Array> {
  const mnemonic = requireWalletSessionMnemonic();
  const material = await derivePrivateMaterial({ mnemonic, chain: "sol", config });
  return material.privateKey as Uint8Array;
}

function decodeBase64Param(value: unknown, label: string): Uint8Array {
  if (typeof value !== "string" || !value) {
    throw new WalletWeb3Error(INVALID_PARAMS, `${label} must be a base64 string.`);
  }
  return new Uint8Array(Buffer.from(value, "base64"));
}

function describeSolTransaction(bytes: Uint8Array) {
  let tx: VersionedTransaction;
  try {
    tx = VersionedTransaction.deserialize(bytes);
  } catch (error) {
    throw new WalletWeb3Error(INVALID_PARAMS, `Invalid Solana transaction: ${String(error)}`);
  }
  const message: VersionedMessage = tx.message;
  const keys = message.staticAccountKeys;
  const programs = [
    ...new Set(
      message.compiledInstructions.map((ix) => keys[ix.programIdIndex]?.toBase58() ?? "lookup"),
    ),
  ];
  return {
    tx,
    details: {
      version: message.version,
      feePayer: keys[0]?.toBase58(),
      instructions: message.compiledInstructions.length,
      programs,
    },
  };
}

function signSolTransaction(tx: VersionedTransaction, keypair: Keypair) {
  const index = tx.message.staticAccountKeys.findIndex((key) => key.equals(keypair.publicKey));
  if (index < 0 || index >= tx.message.header.numRequiredSignatures) {
    throw new WalletWeb3Error(
      UNAUTHORIZED,
      "Transaction does not require the Genesis wallet signer.",
    );
  }
  tx.sign([keypair]);
  return {
    signedTransaction: Buffer.from(tx.serialize()).toString("base64"),
    signature: Buffer.from(tx.signatures[index] as Uint8Array).toString("base64"),
  };
}

async function handleSolRequest(
  config: WalletConfig | undefined,
  request: WalletWeb3Request,
): Promise<unknown> {
  const address = await requireChainAddress(config, "sol");
  const chain = solChain(config);
  const params = (request.params ?? {}) as Record<string, unknown>;
  switch (request.method) {
    case "connect":
      return {
        address,
        publicKey: Buffer.from(new PublicKey(address).toBytes()).toString("base64"),
        chain,
      };
    case "disconnect":
      return null;
    case "signMessage": {
      const message = decodeBase64Param(params.message, "message");
      const text = Buffer.from(message).toString("utf8");
      return queueApproval({
        request,
        network: chain,
        summary: `Sign message: ${text.slice(0, 200)}`,
        details: { address, message: text },
        execute: async () => {
          const key = createPrivateKey({
            key: Buffer.concat([ED25519_PKCS8_PREFIX, await solSeed(config)]),
            format: "der",
            type: "pkcs8",
          });
          return { signature: signEd25519(null, message, key).toString("base64") };
        },
      });
    }
    case "signTransaction":
    case "signAllTransactions":
    case "signAndSendTransaction": {
      assertBrowserSpendingEnabled(config);
      const raw =
        request.method === "signAllTransactions"
          ? Array.isArray(params.transactions)
            ? params.transactions
            : []
          : [params.transaction];
      if (raw.length === 0) {
        throw new WalletWeb3Error(INVALID_PARAMS, "No transactions to sign.");
      }
      const described = raw.map((entry) =>
        describeSolTransaction(decodeBase64Param(entry, "transaction")),
      );
      return queueApproval({
        request,
        network: chain,
        summary: `${request.method} (${described.length} tx) programs ${[
          ...new Set(described.flatMap((entry) => entry.details.programs)),
        ].join(", ")}`,
        details: { address, transactions: described.map((entry) => entry.details) },
        execute: async () => {
          const keypair = Keypair.fromSeed(await solSeed(config));
          const signed = described.map((entry) => signSolTransaction(entry.tx, keypair));
          if (request.method === "signAllTransactions") {
            return { signed };
          }
          if (request.method === "signTransaction") {
            return signed[0];
          }
          const txId = await resolveSolConnection(config?.networks?.sol).sendRawTransaction(
            described[0].tx.serialize(),
            params.options as SendOptions | undefined,
          );
          return {
            ...signed[0],
            txId,
            transactionSignature: Buffer.from(described[0].tx.signatures[0] as Uint8Array).toString(
              "base64",
            ),
          };
        },
      });
    }
    default:
      throw new WalletWeb3Error(UNSUPPORTED_METHOD, `Unsupported method: ${request.method}`);
  }
}

/**
 * Entry point for the browser-injected provider. Read methods resolve
 * immediately; signing methods wait in the approval queue until the agent
 * approves/rejects them (or they time out).
 */
export async function handleWalletWeb3Request(request: WalletWeb3Request): Promise<unknown> {
  const config = loadConfig().wallet;
  assertOriginAllowed(config, request.origin);
  if (request.chain === "evm") {
    return handleEvmRequest(config, request);
  }
  if (request.chain === "sol") {
    return handleSolRequest(config, request);
  }
  throw new WalletWeb3Error(UNSUPPORTED_METHOD, `Unsupported chain: ${String(request.chain)}`);
}
