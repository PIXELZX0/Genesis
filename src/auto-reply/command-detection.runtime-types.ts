import type { GenesisConfig } from "../config/types.js";
import type { CommandNormalizeOptions } from "./commands-registry.types.js";

export type IsControlCommandMessage = (
  text?: string,
  cfg?: GenesisConfig,
  options?: CommandNormalizeOptions,
) => boolean;

export type ShouldComputeCommandAuthorized = (
  text?: string,
  cfg?: GenesisConfig,
  options?: CommandNormalizeOptions,
) => boolean;
