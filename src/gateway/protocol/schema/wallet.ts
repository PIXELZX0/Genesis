import { Type, type Static } from "typebox";

const WalletChainSchema = Type.Union([
  Type.Literal("btc"),
  Type.Literal("evm"),
  Type.Literal("sol"),
  Type.Literal("trx"),
  Type.Literal("xmr"),
]);

export const WalletSummaryParamsSchema = Type.Object(
  {
    includeBalances: Type.Optional(Type.Boolean()),
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

export const WalletSummaryResultSchema = Type.Object(
  {
    enabled: Type.Boolean(),
    keystore: Type.Object(
      {
        exists: Type.Boolean(),
        locked: Type.Boolean(),
      },
      { additionalProperties: false },
    ),
    primaryAccount: Type.Optional(Type.String()),
    accounts: Type.Array(WalletPublicAccountSchema),
    balances: Type.Optional(Type.Array(WalletBalanceSchema)),
    warnings: Type.Array(Type.String()),
  },
  { additionalProperties: false },
);

export type WalletSummaryParams = Static<typeof WalletSummaryParamsSchema>;
export type WalletPublicAccount = Static<typeof WalletPublicAccountSchema>;
export type WalletBalance = Static<typeof WalletBalanceSchema>;
export type WalletSummaryResult = Static<typeof WalletSummaryResultSchema>;
