import { loadConfig } from "../../config/config.js";
import { getWalletBalanceForChain, getWalletSummary } from "../../wallet/service.js";
import { ErrorCodes, errorShape, validateWalletSummaryParams } from "../protocol/index.js";
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
        respond(true, summary, undefined);
        return;
      }
      const balances = [];
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
      respond(true, { ...summary, balances }, undefined);
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, error instanceof Error ? error.message : String(error)),
      );
    }
  },
};
