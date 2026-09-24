import { Type, type Static } from "typebox";

const WalletChainSchema = Type.Union([
  Type.Literal("btc"),
  Type.Literal("evm"),
  Type.Literal("sol"),
  Type.Literal("trx"),
  Type.Literal("xmr"),
  Type.Literal("lndhub"),
]);

export const WalletSummaryParamsSchema = Type.Object(
  {
    includeBalances: Type.Optional(Type.Boolean()),
    includeTokens: Type.Optional(Type.Boolean()),
    includeNfts: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

export const WalletRecoveryPhraseModeSchema = Type.Union([
  Type.Literal("generate"),
  Type.Literal("import"),
]);

export const WalletRecoveryPhraseSetParamsSchema = Type.Object(
  {
    mode: WalletRecoveryPhraseModeSchema,
    passphrase: Type.Optional(Type.String({ maxLength: 16 * 1024 })),
    mnemonic: Type.Optional(Type.String({ minLength: 1, maxLength: 64 * 1024 })),
    overwrite: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

export const WalletUnlockParamsSchema = Type.Object(
  {
    passphrase: Type.String({ maxLength: 16 * 1024 }),
    ttlMs: Type.Optional(Type.Integer({ minimum: 1, maximum: 24 * 60 * 60 * 1000 })),
  },
  { additionalProperties: false },
);

export const NodeWalletWeb3ParamsSchema = Type.Object(
  {
    op: Type.Union([Type.Literal("config"), Type.Literal("request")]),
    chain: Type.Optional(Type.Union([Type.Literal("evm"), Type.Literal("sol")])),
    origin: Type.Optional(Type.String({ minLength: 1, maxLength: 2048 })),
    method: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
    params: Type.Optional(Type.Unknown()),
    chainId: Type.Optional(Type.String({ maxLength: 66 })),
  },
  { additionalProperties: false },
);

export const WalletLockParamsSchema = Type.Object({}, { additionalProperties: false });

export const WalletSessionStatusResultSchema = Type.Object(
  {
    unlocked: Type.Boolean(),
    expiresAt: Type.Optional(Type.Integer({ minimum: 0 })),
  },
  { additionalProperties: false },
);

export const WalletPublicAccountSchema = Type.Object(
  {
    id: Type.String({ minLength: 1 }),
    chain: WalletChainSchema,
    address: Type.String({ minLength: 1 }),
    label: Type.Optional(Type.String()),
    network: Type.Optional(Type.String()),
    derivationPath: Type.Optional(Type.String()),
    createdAt: Type.String(),
    updatedAt: Type.String(),
  },
  { additionalProperties: false },
);

export const WalletBalanceSchema = Type.Object(
  {
    chain: WalletChainSchema,
    accountId: Type.String({ minLength: 1 }),
    address: Type.String({ minLength: 1 }),
    network: Type.Optional(Type.String()),
    asset: Type.String({ minLength: 1 }),
    amountAtomic: Type.String(),
    amount: Type.String(),
    confirmedAmountAtomic: Type.Optional(Type.String()),
    pendingAmountAtomic: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const WalletTokenBalanceSchema = Type.Object(
  {
    chain: Type.Literal("evm"),
    accountId: Type.String({ minLength: 1 }),
    address: Type.String({ minLength: 1 }),
    network: Type.Optional(Type.String()),
    tokenId: Type.String({ minLength: 1 }),
    contractAddress: Type.String({ minLength: 1 }),
    asset: Type.String({ minLength: 1 }),
    name: Type.Optional(Type.String()),
    decimals: Type.Number(),
    amountAtomic: Type.String(),
    amount: Type.String(),
  },
  { additionalProperties: false },
);

export const WalletNftTokenSchema = Type.Object(
  {
    tokenId: Type.String({ minLength: 1 }),
    amount: Type.Optional(Type.String()),
    tokenUri: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const WalletNftCollectionSchema = Type.Object(
  {
    chain: Type.Literal("evm"),
    accountId: Type.String({ minLength: 1 }),
    address: Type.String({ minLength: 1 }),
    network: Type.Optional(Type.String()),
    collectionId: Type.String({ minLength: 1 }),
    contractAddress: Type.String({ minLength: 1 }),
    standard: Type.Union([Type.Literal("erc721"), Type.Literal("erc1155")]),
    name: Type.Optional(Type.String()),
    symbol: Type.Optional(Type.String()),
    balance: Type.Optional(Type.String()),
    tokens: Type.Array(WalletNftTokenSchema),
  },
  { additionalProperties: false },
);

export const WalletSummaryResultSchema = Type.Object(
  {
    enabled: Type.Boolean(),
    keystore: Type.Object(
      {
        exists: Type.Boolean(),
        locked: Type.Boolean(),
        unlockExpiresAt: Type.Optional(Type.Integer({ minimum: 0 })),
      },
      { additionalProperties: false },
    ),
    primaryAccount: Type.Optional(Type.String()),
    accounts: Type.Array(WalletPublicAccountSchema),
    balances: Type.Optional(Type.Array(WalletBalanceSchema)),
    tokens: Type.Optional(Type.Array(WalletTokenBalanceSchema)),
    nfts: Type.Optional(Type.Array(WalletNftCollectionSchema)),
    warnings: Type.Array(Type.String()),
  },
  { additionalProperties: false },
);

export const WalletRecoveryPhraseSetResultSchema = Type.Object(
  {
    mnemonicGenerated: Type.Boolean(),
    mnemonic: Type.Optional(Type.String({ minLength: 1 })),
    summary: WalletSummaryResultSchema,
  },
  { additionalProperties: false },
);

export type WalletSummaryParams = Static<typeof WalletSummaryParamsSchema>;
export type WalletRecoveryPhraseMode = Static<typeof WalletRecoveryPhraseModeSchema>;
export type WalletRecoveryPhraseSetParams = Static<typeof WalletRecoveryPhraseSetParamsSchema>;
export type WalletUnlockParams = Static<typeof WalletUnlockParamsSchema>;
export type WalletLockParams = Static<typeof WalletLockParamsSchema>;
export type NodeWalletWeb3Params = Static<typeof NodeWalletWeb3ParamsSchema>;
export type WalletSessionStatusResult = Static<typeof WalletSessionStatusResultSchema>;
export type WalletPublicAccount = Static<typeof WalletPublicAccountSchema>;
export type WalletBalance = Static<typeof WalletBalanceSchema>;
export type WalletTokenBalance = Static<typeof WalletTokenBalanceSchema>;
export type WalletNftToken = Static<typeof WalletNftTokenSchema>;
export type WalletNftCollection = Static<typeof WalletNftCollectionSchema>;
export type WalletSummaryResult = Static<typeof WalletSummaryResultSchema>;
export type WalletRecoveryPhraseSetResult = Static<typeof WalletRecoveryPhraseSetResultSchema>;
