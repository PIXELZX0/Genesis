import type { GatewayBrowserClient } from "../gateway.ts";
import type { WalletRecoveryPhraseSetResult, WalletSummaryResult } from "../types.ts";

export type WalletRecoveryPhraseMode = "generate" | "import";

export type WalletRecoveryPhraseInput = {
  mode: WalletRecoveryPhraseMode;
  mnemonic: string;
  passphrase: string;
  confirmPassphrase: string;
  overwrite: boolean;
};

export type WalletState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  walletSummary: WalletSummaryResult | null;
  walletSummaryError: string | null;
  walletSummaryLoading: boolean;
  walletBalancesLoading: boolean;
  walletLastUpdatedAt: number | null;
  walletRecoveryPhraseMode: WalletRecoveryPhraseMode;
  walletRecoveryPhraseBusy: boolean;
  walletRecoveryPhraseError: string | null;
  walletRecoveryPhraseGeneratedMnemonic: string | null;
  walletRecoveryPhraseStatus: "generated" | "imported" | null;
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
    const params = includeBalances
      ? { includeBalances: true, includeTokens: true, includeNfts: true }
      : {};
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

export async function setWalletRecoveryPhrase(
  state: WalletState,
  input: WalletRecoveryPhraseInput,
): Promise<boolean> {
  if (!state.client || !state.connected) {
    state.walletRecoveryPhraseError = "Connect to the gateway before updating the wallet.";
    return false;
  }
  if (input.mode === "generate" && input.passphrase !== input.confirmPassphrase) {
    state.walletRecoveryPhraseError = "Wallet passphrase confirmation does not match.";
    return false;
  }
  const mnemonic = input.mnemonic.trim().replace(/\s+/g, " ");
  if (input.mode === "import" && !mnemonic) {
    state.walletRecoveryPhraseError = "Secret recovery phrase is required.";
    return false;
  }

  state.walletRecoveryPhraseBusy = true;
  state.walletRecoveryPhraseError = null;
  state.walletRecoveryPhraseGeneratedMnemonic = null;
  state.walletRecoveryPhraseStatus = null;
  try {
    const passphrase = input.passphrase.length > 0 ? input.passphrase : undefined;
    const params =
      input.mode === "generate"
        ? {
            mode: input.mode,
            ...(passphrase === undefined ? {} : { passphrase }),
            overwrite: input.overwrite,
          }
        : {
            mode: input.mode,
            mnemonic,
            ...(passphrase === undefined ? {} : { passphrase }),
            overwrite: input.overwrite,
          };
    const result = (await state.client.request(
      "wallet.recoveryPhrase.set",
      params,
    )) as WalletRecoveryPhraseSetResult;
    state.walletSummary = result.summary;
    state.walletSummaryError = null;
    state.walletLastUpdatedAt = Date.now();
    state.walletRecoveryPhraseGeneratedMnemonic = result.mnemonic ?? null;
    state.walletRecoveryPhraseStatus = result.mnemonicGenerated ? "generated" : "imported";
    return true;
  } catch (error) {
    state.walletRecoveryPhraseError = getErrorMessage(error);
    return false;
  } finally {
    state.walletRecoveryPhraseBusy = false;
  }
}
