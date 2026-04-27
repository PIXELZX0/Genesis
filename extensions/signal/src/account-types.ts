import type { GenesisConfig } from "genesis/plugin-sdk/config-runtime";

export type SignalAccountConfig = Omit<
  Exclude<NonNullable<GenesisConfig["channels"]>["signal"], undefined>,
  "accounts"
>;
