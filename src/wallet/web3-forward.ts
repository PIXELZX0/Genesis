// Node hosts drive their own browser but the keystore, unlock session, and
// approval queue live in the gateway. The node runner registers a forwarder
// here; the browser plugin uses it instead of handling requests locally.

export type WalletWeb3ForwardParams =
  | { op: "config" }
  | {
      op: "request";
      chain: "evm" | "sol";
      origin: string;
      method: string;
      params?: unknown;
      chainId?: string;
    };

// Signing requests can wait up to the 5-minute approval window in the gateway.
export const WALLET_WEB3_FORWARD_TIMEOUT_MS = 6 * 60 * 1000;

export type WalletWeb3Forwarder = (params: WalletWeb3ForwardParams) => Promise<unknown>;

// Live mutable state: direct globalThis lookup so the node runner and plugin
// chunks share one slot.
const FORWARDER_KEY = Symbol.for("genesis.wallet.web3.forwarder");

export function setWalletWeb3GatewayForwarder(forwarder: WalletWeb3Forwarder | undefined): void {
  (globalThis as Record<PropertyKey, unknown>)[FORWARDER_KEY] = forwarder;
}

export function getWalletWeb3GatewayForwarder(): WalletWeb3Forwarder | undefined {
  return (globalThis as Record<PropertyKey, unknown>)[FORWARDER_KEY] as
    | WalletWeb3Forwarder
    | undefined;
}
