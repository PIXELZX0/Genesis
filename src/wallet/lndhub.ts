import { normalizeResolvedSecretInputString } from "../config/types.secrets.js";
import type { WalletConfig, WalletLndHubNetworkConfig } from "../config/types.wallet.js";
import { formatAtomicAmount, parseDecimalAmount } from "./amounts.js";
import type { WalletBalance, WalletQuote, WalletSendResult } from "./types.js";

let cachedAccessToken: string | undefined;

export function resetLndHubAuthCache(): void {
  cachedAccessToken = undefined;
}

function resolveSecretString(value: unknown, path: string): string | undefined {
  return normalizeResolvedSecretInputString({ value, path });
}

function resolveLndHubConfig(config?: WalletConfig): WalletLndHubNetworkConfig | undefined {
  return config?.networks?.lndhub;
}

function requireBaseUrl(config?: WalletLndHubNetworkConfig): string {
  const url = resolveSecretString(config?.baseUrl, "wallet.networks.lndhub.baseUrl");
  if (!url) {
    throw new Error("wallet.networks.lndhub.baseUrl is required for LndHub wallet.");
  }
  return url.replace(/\/+$/, "");
}

async function lndHubRequest<T>(params: {
  config?: WalletLndHubNetworkConfig;
  method: string;
  path: string;
  body?: Record<string, unknown>;
  retryAuth?: boolean;
}): Promise<T> {
  const baseUrl = requireBaseUrl(params.config);
  const url = `${baseUrl}${params.path}`;
  const headers: Record<string, string> = {};

  if (params.path !== "/auth") {
    if (!cachedAccessToken) {
      const login = resolveSecretString(params.config?.login, "wallet.networks.lndhub.login");
      const password = resolveSecretString(
        params.config?.password,
        "wallet.networks.lndhub.password",
      );
      const authResponse = await fetch(`${baseUrl}/auth`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ login: login ?? "", password: password ?? "" }),
      });
      if (!authResponse.ok) {
        const text = await authResponse.text().catch(() => "");
        throw new Error(`LndHub auth HTTP ${authResponse.status}${text ? `: ${text}` : ""}`);
      }
      const authPayload = (await authResponse.json()) as { access_token?: string };
      if (!authPayload.access_token) {
        throw new Error("LndHub auth returned no access_token.");
      }
      cachedAccessToken = authPayload.access_token;
    }
    headers.authorization = `Bearer ${cachedAccessToken}`;
  }

  if (params.body) {
    headers["content-type"] = "application/json";
  }

  const response = await fetch(url, {
    method: params.method,
    headers,
    body: params.body ? JSON.stringify(params.body) : undefined,
  });

  if (response.status === 401 && params.retryAuth !== false) {
    cachedAccessToken = undefined;
    return lndHubRequest({ ...params, retryAuth: false });
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`LndHub HTTP ${response.status}${text ? `: ${text}` : ""}`);
  }

  return (await response.json()) as T;
}

export async function getLndHubAddress(config?: WalletConfig): Promise<string> {
  const lndhub = resolveLndHubConfig(config);
  const lightningAddress = lndhub?.lightningAddress;
  if (lightningAddress) {
    return lightningAddress;
  }
  const result = await lndHubRequest<{ address?: string }>({
    config: lndhub,
    method: "GET",
    path: "/getbtc",
  });
  if (!result.address) {
    throw new Error("LndHub /getbtc returned no address.");
  }
  return result.address;
}

export async function getLndHubBalance(config?: WalletConfig): Promise<WalletBalance> {
  const lndhub = resolveLndHubConfig(config);
  const address = await getLndHubAddress(config);
  const result = await lndHubRequest<{ BTC?: { AvailableBalance?: number } }>({
    config: lndhub,
    method: "GET",
    path: "/balance",
  });
  const balanceSat = result.BTC?.AvailableBalance ?? 0;
  const balanceAtomic = BigInt(balanceSat);
  return {
    chain: "lndhub",
    accountId: "lndhub:rpc",
    address,
    network: "lndhub",
    asset: "BTC",
    amountAtomic: balanceAtomic.toString(),
    amount: formatAtomicAmount(balanceAtomic, 8),
    confirmedAmountAtomic: balanceAtomic.toString(),
    pendingAmountAtomic: "0",
  };
}

export async function quoteLndHubSend(params: {
  to: string;
  amount: string;
  config?: WalletConfig;
}): Promise<WalletQuote> {
  const address = await getLndHubAddress(params.config);
  const amountAtomic = parseDecimalAmount(params.amount, 8);
  return {
    chain: "lndhub",
    accountId: "lndhub:rpc",
    network: "lndhub",
    from: address,
    to: params.to,
    asset: "BTC",
    amountAtomic: amountAtomic.toString(),
    amount: formatAtomicAmount(amountAtomic, 8),
    estimatedFeeAtomic: "0",
    estimatedFee: "0",
  };
}

export async function sendLndHubTransaction(params: {
  to: string;
  amount: string;
  config?: WalletConfig;
}): Promise<WalletSendResult> {
  const quote = await quoteLndHubSend(params);
  if (!params.to.startsWith("lnbc")) {
    throw new Error("LndHub send requires a BOLT11 invoice (lnbc...).");
  }
  const result = await lndHubRequest<{ payment_hash?: string; payment_preimage?: string }>({
    config: resolveLndHubConfig(params.config),
    method: "POST",
    path: "/payinvoice",
    body: { invoice: params.to },
  });
  if (!result.payment_hash) {
    throw new Error("LndHub /payinvoice returned no payment_hash.");
  }
  return {
    ...quote,
    txId: result.payment_hash,
    explorerUrl: params.config?.networks?.lndhub?.explorerTxUrl
      ? `${params.config.networks.lndhub.explorerTxUrl.replace(/\/+$/, "")}/${result.payment_hash}`
      : undefined,
    raw: result,
  };
}
