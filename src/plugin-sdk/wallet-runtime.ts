// Browser-host seam for the injected web3 provider (EIP-1193 / Solana Wallet Standard).
// The host resolves the caller origin; signing requests wait for agent approval.
// On node hosts, requests go through the gateway forwarder instead.

export {
  getWalletBrowserProviderConfig,
  handleWalletWeb3Request,
  WalletWeb3Error,
  type WalletBrowserProviderConfig,
  type WalletWeb3Chain,
  type WalletWeb3Request,
} from "../wallet/web3.js";
export {
  getWalletWeb3GatewayForwarder,
  type WalletWeb3ForwardParams,
  type WalletWeb3Forwarder,
} from "../wallet/web3-forward.js";
