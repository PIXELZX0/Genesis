import type { GenesisConfig } from "../../config/types.genesis.js";

export function createPerSenderSessionConfig(
  overrides: Partial<NonNullable<GenesisConfig["session"]>> = {},
): NonNullable<GenesisConfig["session"]> {
  return {
    mainKey: "main",
    scope: "per-sender",
    ...overrides,
  };
}
