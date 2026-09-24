import { Type } from "typebox";
import type { GenesisConfig } from "../../config/types.genesis.js";
import { stringEnum } from "../schema/string-enum.js";
import { type AnyAgentTool, jsonResult, readStringParam, ToolInputError } from "./common.js";

const WALLET_ACTIONS = ["status", "pending", "approve", "reject"] as const;

const WalletToolSchema = Type.Object({
  action: stringEnum(WALLET_ACTIONS, {
    description:
      "status: wallet lock state and addresses. pending: signing requests raised by browser pages. approve/reject: decide one pending request.",
  }),
  requestId: Type.Optional(Type.String({ description: "Pending request id (approve/reject)." })),
  reason: Type.Optional(Type.String({ description: "Optional rejection reason (reject)." })),
});

export function isWalletToolEnabled(config?: GenesisConfig): boolean {
  return config?.wallet?.enabled !== false && config?.wallet?.browser?.enabled === true;
}

export function createWalletTool(): AnyAgentTool {
  return {
    label: "Wallet",
    name: "wallet",
    displaySummary: "Web3 wallet approvals",
    ownerOnly: true,
    description:
      'Genesis web3 wallet. Pages opened with the browser tool have an injected EVM provider (window.ethereum, EIP-6963 "Genesis") and Solana wallet (Wallet Standard "Genesis", window.solana); connect with those in the dApp UI. Signing or sending from a page waits here: list with action=pending, inspect origin/summary/details, then approve or reject. Approve only requests you intended; never approve requests from unexpected origins. If the wallet is locked, ask the user to run `genesis wallet unlock`.',
    parameters: WalletToolSchema,
    execute: async (_toolCallId, args) => {
      const input = args as Record<string, unknown>;
      const action = readStringParam(input, "action", { required: true });
      const runtime = await import("../../wallet/web3.runtime.js");
      switch (action) {
        case "status": {
          const accounts = await runtime.getWalletAccounts();
          return jsonResult({
            session: runtime.getWalletSessionStatus(),
            accounts: accounts
              .filter((account) => account.chain === "evm" || account.chain === "sol")
              .map((account) => ({
                id: account.id,
                chain: account.chain,
                address: account.address,
                network: account.network,
              })),
            pending: runtime.listWalletWeb3PendingRequests().length,
          });
        }
        case "pending":
          return jsonResult({ requests: runtime.listWalletWeb3PendingRequests() });
        case "approve": {
          const requestId = readStringParam(input, "requestId", { required: true });
          return jsonResult({ approved: await runtime.approveWalletWeb3Request(requestId) });
        }
        case "reject": {
          const requestId = readStringParam(input, "requestId", { required: true });
          const reason = readStringParam(input, "reason");
          return jsonResult({ rejected: runtime.rejectWalletWeb3Request(requestId, reason) });
        }
        default:
          throw new ToolInputError(`action must be one of ${WALLET_ACTIONS.join(", ")}`);
      }
    },
  };
}
