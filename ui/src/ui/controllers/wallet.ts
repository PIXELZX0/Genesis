import type { GatewayBrowserClient } from "../gateway.ts";
import type { WalletSummaryResult } from "../types.ts";

export type WalletState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  walletSummary: WalletSummaryResult | null;
  walletSummaryError: string | null;
  walletSummaryLoading: boolean;
  walletBalancesLoading: boolean;
  walletLastUpdatedAt: number | null;
};

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function loadWalletSummary(
  state: WalletState,
  opts: { includeBalances?: boolean } = {},
) {
  if (!state.client || !state.connected) {
    return;
  }
  const includeBalances = opts.includeBalances === true;
  state.walletSummaryLoading = true;
  state.walletBalancesLoading = includeBalances;
  try {
    const params = includeBalances ? { includeBalances: true } : {};
    state.walletSummary = (await state.client.request(
      "wallet.summary",
      params,
    )) as WalletSummaryResult;
    state.walletSummaryError = null;
    state.walletLastUpdatedAt = Date.now();
  } catch (error) {
    state.walletSummary = null;
    state.walletSummaryError = getErrorMessage(error);
  } finally {
    state.walletSummaryLoading = false;
    state.walletBalancesLoading = false;
  }
}
