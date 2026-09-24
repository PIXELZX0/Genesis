import { loadConfig } from "../../config/config.js";
import {
  getWalletBalanceForChain,
  getWalletNftCollectionsForAccount,
  getWalletSummary,
  getWalletTokenBalancesForAccount,
  setWalletRecoveryPhrase,
} from "../../wallet/service.js";
import { lockWalletSession, unlockWalletSession } from "../../wallet/session.js";
import type { WalletBalance, WalletNftCollection, WalletTokenBalance } from "../../wallet/types.js";
import {
  getWalletBrowserProviderConfig,
  handleWalletWeb3Request,
  WalletWeb3Error,
} from "../../wallet/web3.js";
import {
  ErrorCodes,
  errorShape,
  validateNodeWalletWeb3Params,
  validateWalletLockParams,
  validateWalletRecoveryPhraseSetParams,
  validateWalletSummaryParams,
  validateWalletUnlockParams,
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
  "wallet.unlock": async ({ respond, params }) => {
    if (!assertValidParams(params, validateWalletUnlockParams, "wallet.unlock", respond)) {
      return;
    }
    try {
      respond(
        true,
        await unlockWalletSession({ passphrase: params.passphrase, ttlMs: params.ttlMs }),
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
  "wallet.lock": async ({ respond, params }) => {
    if (!assertValidParams(params, validateWalletLockParams, "wallet.lock", respond)) {
      return;
    }
    respond(true, lockWalletSession(), undefined);
  },
  // Node-role: browser pages on a node host reach the gateway wallet and approval queue.
  // The node reports the page origin it resolved from the frame.
  "node.wallet.web3": async ({ respond, params }) => {
    if (!assertValidParams(params, validateNodeWalletWeb3Params, "node.wallet.web3", respond)) {
      return;
    }
    if (params.op === "config") {
      respond(true, getWalletBrowserProviderConfig(), undefined);
      return;
    }
    if (!params.chain || !params.origin || !params.method) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          "node.wallet.web3 request needs chain, origin, method",
        ),
      );
      return;
    }
    try {
      const result = await handleWalletWeb3Request({
        chain: params.chain,
        origin: params.origin,
        method: params.method,
        params: params.params,
        chainId: params.chainId,
      });
      respond(true, { ok: true, result: result ?? null }, undefined);
    } catch (error) {
      respond(
        true,
        {
          ok: false,
          code: error instanceof WalletWeb3Error ? error.code : -32603,
          message: error instanceof Error ? error.message : String(error),
        },
        undefined,
      );
    }
  },
};
