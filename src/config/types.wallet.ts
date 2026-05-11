import type { SecretInput } from "./types.secrets.js";

export type WalletChain = "btc" | "evm" | "sol" | "trx" | "xmr";

export type WalletBtcNetwork = "mainnet" | "testnet" | "regtest";
export type WalletSolNetwork = "mainnet-beta" | "testnet" | "devnet";

export type WalletBtcNetworkConfig = {
  enabled?: boolean;
  network?: WalletBtcNetwork;
  esploraUrl?: SecretInput;
  feeRateSatPerVbyte?: number;
  derivationPath?: string;
};

export type WalletEvmTokenConfig = {
  enabled?: boolean;
  address: string;
  symbol?: string;
  name?: string;
  decimals?: number;
};

export type WalletEvmNftStandard = "erc721" | "erc1155";

export type WalletEvmNftConfig = {
  enabled?: boolean;
  address: string;
  standard?: WalletEvmNftStandard;
  name?: string;
  symbol?: string;
  tokenIds?: string[];
};

export type WalletEvmChainConfig = {
  enabled?: boolean;
  chainId?: number;
  name?: string;
  rpcUrl?: SecretInput;
  currencySymbol?: string;
  explorerTxUrl?: string;
  tokens?: Record<string, WalletEvmTokenConfig>;
  nfts?: Record<string, WalletEvmNftConfig>;
};

export type WalletEvmNetworkConfig = WalletEvmChainConfig & {
  derivationPath?: string;
  chains?: Record<string, WalletEvmChainConfig>;
};

export type WalletSolNetworkConfig = {
  enabled?: boolean;
  network?: WalletSolNetwork;
  rpcUrl?: SecretInput;
  derivationPath?: string;
  explorerTxUrl?: string;
};

export type WalletTrxNetworkConfig = {
  enabled?: boolean;
  fullHost?: SecretInput;
  apiKey?: SecretInput;
  derivationPath?: string;
  explorerTxUrl?: string;
};

export type WalletXmrNetworkConfig = {
  enabled?: boolean;
  walletRpcUrl?: SecretInput;
  username?: SecretInput;
  password?: SecretInput;
  accountIndex?: number;
  addressIndex?: number;
  explorerTxUrl?: string;
};

export type WalletSpendingConfig = {
  enabled?: boolean;
  requireAllowEnv?: boolean;
  maxNativeAmount?: string;
};

export type WalletConfig = {
  enabled?: boolean;
  primaryAccount?: string;
  networks?: {
    btc?: WalletBtcNetworkConfig;
    evm?: WalletEvmNetworkConfig;
    sol?: WalletSolNetworkConfig;
    trx?: WalletTrxNetworkConfig;
    xmr?: WalletXmrNetworkConfig;
  };
  spending?: WalletSpendingConfig;
};
