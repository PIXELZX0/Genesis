import { loadConfig } from "../../config/config.js";
import {
  getWalletBalanceForChain,
  getWalletNftCollectionsForAccount,
  getWalletSummary,
  getWalletTokenBalancesForAccount,
  setWalletRecoveryPhrase,
} from "../../wallet/service.js";
import type { WalletBalance, WalletNftCollection, WalletTokenBalance } from "../../wallet/types.js";
import {
  ErrorCodes,
  errorShape,
  validateWalletRecoveryPhraseSetParams,
  validateWalletSummaryParams,
} from "../protocol/index.js";
import type { GatewayRequestHandlers } from "./types.js";
import { assertValidParams } from "./validation.js";

export const walletHandlers: GatewayRequestHandlers = {
  "wallet.summary": async ({ respond, params }) => {
    if (!assertValidParams(params, validateWalletSummaryParams, "wallet.summary", respond)) {
      return;
    }
    const config = loadConfig().wallet;
    try {
      const summary = await getWalletSummary({ config });
      if (!params.includeBalances) {
        if (!params.includeTokens && !params.includeNfts) {
          respond(true, summary, undefined);
          return;
        }
      }
      let balances: WalletBalance[] | undefined;
      if (params.includeBalances) {
        balances = [];
        for (const account of summary.accounts) {
          try {
            balances.push(
              await getWalletBalanceForChain({
                config,
                chain: account.chain,
                accountId: account.id,
              }),
            );
          } catch (error) {
            summary.warnings.push(error instanceof Error ? error.message : String(error));
          }
        }
      }
      let tokens: WalletTokenBalance[] | undefined;
      if (params.includeTokens) {
        try {
          tokens = await getWalletTokenBalancesForAccount({ config });
        } catch (error) {
          summary.warnings.push(error instanceof Error ? error.message : String(error));
        }
      }
      let nfts: WalletNftCollection[] | undefined;
      if (params.includeNfts) {
        try {
          nfts = await getWalletNftCollectionsForAccount({ config });
        } catch (error) {
          summary.warnings.push(error instanceof Error ? error.message : String(error));
        }
      }
      respond(
        true,
        {
          ...summary,
          ...(balances === undefined ? {} : { balances }),
          ...(tokens === undefined ? {} : { tokens }),
          ...(nfts === undefined ? {} : { nfts }),
        },
        undefined,
      );
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, error instanceof Error ? error.message : String(error)),
      );
    }
  },
  "wallet.recoveryPhrase.set": async ({ respond, params }) => {
    if (
      !assertValidParams(
        params,
        validateWalletRecoveryPhraseSetParams,
        "wallet.recoveryPhrase.set",
        respond,
      )
    ) {
      return;
    }
    if (params.mode === "import" && !params.mnemonic?.trim()) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "wallet.recoveryPhrase.set requires mnemonic"),
      );
      return;
    }
    const config = loadConfig().wallet;
    try {
      const result = await setWalletRecoveryPhrase({
        config,
        mode: params.mode,
        passphrase: params.passphrase,
        mnemonic: params.mnemonic,
        overwrite: params.overwrite === true,
      });
      respond(true, result, undefined);
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, error instanceof Error ? error.message : String(error)),
      );
    }
  },
};
