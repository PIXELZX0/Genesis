import type { GenesisConfig } from "../config/types.genesis.js";
import { trimToUndefined, type ExplicitGatewayAuth } from "./credentials.js";

export function hasExplicitGatewayConnectionAuth(auth?: ExplicitGatewayAuth): boolean {
  return Boolean(trimToUndefined(auth?.token) || trimToUndefined(auth?.password));
}

export function canSkipGatewayConfigLoad(params: {
  config?: GenesisConfig;
  urlOverride?: string;
  explicitAuth?: ExplicitGatewayAuth;
}): boolean {
  return (
    !params.config &&
    Boolean(trimToUndefined(params.urlOverride)) &&
    hasExplicitGatewayConnectionAuth(params.explicitAuth)
  );
}

export function isGatewayConfigBypassCommandPath(commandPath: readonly string[]): boolean {
  return commandPath[0] === "cron";
}
