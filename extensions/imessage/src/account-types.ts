import type { GenesisConfig } from "genesis/plugin-sdk/config-runtime";

export type IMessageAccountConfig = Omit<
  NonNullable<NonNullable<GenesisConfig["channels"]>["imessage"]>,
  "accounts" | "defaultAccount"
>;
