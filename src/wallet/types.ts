import type { WalletChain } from "../config/types.wallet.js";

export type { WalletChain } from "../config/types.wallet.js";

export const WALLET_CHAINS = ["btc", "evm", "sol", "trx", "xmr"] as const;
export const LOCAL_KEYSTORE_WALLET_CHAINS = ["btc", "evm", "sol", "trx"] as const;

export type LocalKeystoreWalletChain = (typeof LOCAL_KEYSTORE_WALLET_CHAINS)[number];

export const DEFAULT_DERIVATION_PATHS: Record<LocalKeystoreWalletChain, string> = {
  btc: "m/84'/0'/0'/0/0",
  evm: "m/44'/60'/0'/0/0",
  sol: "m/44'/501'/0'/0'",
  trx: "m/44'/195'/0'/0/0",
};

export type WalletPublicAccount = {
  id: string;
  chain: WalletChain;
  address: string;
  label?: string;
  network?: string;
  derivationPath?: string;
  createdAt: string;
  updatedAt: string;
};

export type WalletKeystoreStatus = {
  exists: boolean;
  locked: boolean;
};

export type WalletSummary = {
  enabled: boolean;
  keystore: WalletKeystoreStatus;
  primaryAccount?: string;
  accounts: WalletPublicAccount[];
  warnings: string[];
};

export type WalletBalance = {
  chain: WalletChain;
  accountId: string;
  address: string;
  network?: string;
  asset: string;
  amountAtomic: string;
  amount: string;
  confirmedAmountAtomic?: string;
  pendingAmountAtomic?: string;
};

export type WalletQuote = {
  chain: WalletChain;
  accountId: string;
  network?: string;
  from: string;
  to: string;
  asset: string;
  amountAtomic: string;
  amount: string;
  estimatedFeeAtomic?: string;
  estimatedFee?: string;
  raw?: unknown;
};

export type WalletSendResult = {
  chain: WalletChain;
  accountId: string;
  network?: string;
  from: string;
  to: string;
  asset: string;
  amountAtomic: string;
  amount: string;
  txId: string;
  explorerUrl?: string;
  raw?: unknown;
};

export type WalletSignaturePayloadKind = "message" | "message-hex" | "digest";

export type WalletSignatureResult = {
  chain: WalletChain;
  accountId: string;
  address: string;
  network?: string;
  payloadKind: WalletSignaturePayloadKind;
  signature: string;
  r?: string;
  s?: string;
  v?: number;
  yParity?: 0 | 1;
  digest?: string;
  messageHex?: string;
};

export type WalletSignedRawTransaction = {
  chain: WalletChain;
  accountId: string;
  address: string;
  network?: string;
  rawTransaction: string;
  txId?: string;
};

export type WalletBroadcastResult = {
  chain: WalletChain;
  accountId: string;
  address: string;
  network?: string;
  txId: string;
};

export type WalletPrivatePayload = {
  version: 1;
  mnemonic: string;
  createdAt: string;
  updatedAt: string;
};

export type WalletPrivateMaterial = {
  chain: LocalKeystoreWalletChain;
  address: string;
  privateKey: Uint8Array | string;
  publicKey?: Uint8Array;
  derivationPath: string;
  network?: string;
};
