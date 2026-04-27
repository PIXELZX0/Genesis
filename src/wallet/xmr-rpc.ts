import { Buffer } from "node:buffer";
import { normalizeResolvedSecretInputString } from "../config/types.secrets.js";
import type { WalletConfig, WalletXmrNetworkConfig } from "../config/types.wallet.js";
import { formatAtomicAmount, parseDecimalAmount } from "./amounts.js";
import type { WalletBalance, WalletQuote, WalletSendResult } from "./types.js";

type MoneroRpcResponse<T> = {
  id?: string;
  jsonrpc?: string;
  result?: T;
  error?: { code?: number; message?: string };
};

type XmrAddressResult = {
  address?: string;
  addresses?: Array<{ address?: string; address_index?: number; used?: boolean }>;
};

type XmrBalanceResult = {
  balance?: number | string;
  unlocked_balance?: number | string;
};

type XmrTransferResult = {
  tx_hash?: string;
  tx_key?: string;
  amount?: number | string;
  fee?: number | string;
};

function resolveSecretString(value: unknown, path: string): string | undefined {
  return normalizeResolvedSecretInputString({ value, path });
}

function resolveXmrConfig(config?: WalletConfig): WalletXmrNetworkConfig | undefined {
  return config?.networks?.xmr;
}

function requireRpcUrl(config?: WalletXmrNetworkConfig): string {
  const url = resolveSecretString(config?.walletRpcUrl, "wallet.networks.xmr.walletRpcUrl");
  if (!url) {
    throw new Error("wallet.networks.xmr.walletRpcUrl is required for Monero wallet RPC.");
  }
  return url;
}

function atomicFromRpcValue(value: number | string | undefined, label: string): bigint {
  if (value === undefined) {
    return 0n;
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`monero-wallet-rpc returned an unsafe ${label} amount.`);
    }
    return BigInt(value);
  }
  return BigInt(value);
}

function safeRpcAmountNumber(value: bigint, label: string): number {
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric) || numeric <= 0) {
    throw new Error(`${label} is outside the supported Monero wallet RPC number range.`);
  }
  return numeric;
}

async function callMoneroWalletRpc<T>(params: {
  config?: WalletXmrNetworkConfig;
  method: string;
  body?: Record<string, unknown>;
}): Promise<T> {
  const url = requireRpcUrl(params.config);
  const headers: Record<string, string> = { "content-type": "application/json" };
  const username = resolveSecretString(params.config?.username, "wallet.networks.xmr.username");
  const password = resolveSecretString(params.config?.password, "wallet.networks.xmr.password");
  if (username || password) {
    headers.authorization = `Basic ${Buffer.from(`${username ?? ""}:${password ?? ""}`).toString(
      "base64",
    )}`;
  }
  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "genesis-wallet",
      method: params.method,
      params: params.body ?? {},
    }),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`monero-wallet-rpc HTTP ${response.status}${text ? `: ${text}` : ""}`);
  }
  const payload = (await response.json()) as MoneroRpcResponse<T>;
  if (payload.error) {
    throw new Error(payload.error.message ?? `monero-wallet-rpc error ${payload.error.code}`);
  }
  if (payload.result === undefined) {
    throw new Error("monero-wallet-rpc returned no result.");
  }
  return payload.result;
}

export async function getXmrAddress(config?: WalletConfig): Promise<string> {
  const xmr = resolveXmrConfig(config);
  const accountIndex = xmr?.accountIndex ?? 0;
  const addressIndex = xmr?.addressIndex ?? 0;
  const result = await callMoneroWalletRpc<XmrAddressResult>({
    config: xmr,
    method: "get_address",
    body: { account_index: accountIndex, address_index: [addressIndex] },
  });
  const indexed = result.addresses?.find((entry) => entry.address_index === addressIndex)?.address;
  const address = indexed ?? result.address;
  if (!address) {
    throw new Error("monero-wallet-rpc returned no address.");
  }
  return address;
}

export async function getXmrBalance(config?: WalletConfig): Promise<WalletBalance> {
  const xmr = resolveXmrConfig(config);
  const accountIndex = xmr?.accountIndex ?? 0;
  const address = await getXmrAddress(config);
  const result = await callMoneroWalletRpc<XmrBalanceResult>({
    config: xmr,
    method: "get_balance",
    body: { account_index: accountIndex },
  });
  const balance = atomicFromRpcValue(result.balance, "balance");
  const unlocked = atomicFromRpcValue(result.unlocked_balance, "unlocked balance");
  return {
    chain: "xmr",
    accountId: "xmr:rpc",
    address,
    network: "monero-wallet-rpc",
    asset: "XMR",
    amountAtomic: balance.toString(),
    amount: formatAtomicAmount(balance, 12),
    confirmedAmountAtomic: unlocked.toString(),
    pendingAmountAtomic: (balance - unlocked).toString(),
  };
}

export async function quoteXmrSend(params: {
  to: string;
  amount: string;
  config?: WalletConfig;
}): Promise<WalletQuote> {
  const address = await getXmrAddress(params.config);
  const amountAtomic = parseDecimalAmount(params.amount, 12);
  return {
    chain: "xmr",
    accountId: "xmr:rpc",
    network: "monero-wallet-rpc",
    from: address,
    to: params.to,
    asset: "XMR",
    amountAtomic: amountAtomic.toString(),
    amount: formatAtomicAmount(amountAtomic, 12),
  };
}

export async function sendXmrTransaction(params: {
  to: string;
  amount: string;
  config?: WalletConfig;
}): Promise<WalletSendResult> {
  const quote = await quoteXmrSend(params);
  const amountAtomic = BigInt(quote.amountAtomic);
  const result = await callMoneroWalletRpc<XmrTransferResult>({
    config: resolveXmrConfig(params.config),
    method: "transfer",
    body: {
      destinations: [
        { address: params.to, amount: safeRpcAmountNumber(amountAtomic, "XMR amount") },
      ],
      account_index: params.config?.networks?.xmr?.accountIndex ?? 0,
      priority: 0,
      get_tx_key: true,
    },
  });
  if (!result.tx_hash) {
    throw new Error("monero-wallet-rpc transfer returned no tx_hash.");
  }
  return {
    ...quote,
    txId: result.tx_hash,
    explorerUrl: params.config?.networks?.xmr?.explorerTxUrl
      ? `${params.config.networks.xmr.explorerTxUrl.replace(/\/+$/, "")}/${result.tx_hash}`
      : undefined,
    raw: result,
  };
}
