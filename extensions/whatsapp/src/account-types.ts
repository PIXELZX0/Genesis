import type { GenesisConfig } from "genesis/plugin-sdk/config-runtime";

export type WhatsAppAccountConfig = NonNullable<
  NonNullable<NonNullable<GenesisConfig["channels"]>["whatsapp"]>["accounts"]
>[string];
