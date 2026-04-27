import type { ChannelDoctorConfigMutation } from "genesis/plugin-sdk/channel-contract";
import type { GenesisConfig } from "genesis/plugin-sdk/config-runtime";
import { normalizeCompatibilityConfig as normalizeCompatibilityConfigImpl } from "./doctor.js";

export function normalizeCompatibilityConfig({
  cfg,
}: {
  cfg: GenesisConfig;
}): ChannelDoctorConfigMutation {
  return normalizeCompatibilityConfigImpl({ cfg });
}
