import type { GenesisConfig } from "../config/types.genesis.js";
import {
  resolveGatewayProbeAuthSafeWithSecretInputs,
  resolveGatewayProbeTarget,
} from "../gateway/probe-auth.js";
export { pickGatewaySelfPresence } from "./gateway-presence.js";

export async function resolveGatewayProbeAuthResolution(cfg: GenesisConfig): Promise<{
  auth: {
    token?: string;
    password?: string;
  };
  warning?: string;
}> {
  const target = resolveGatewayProbeTarget(cfg);
  return resolveGatewayProbeAuthSafeWithSecretInputs({
    cfg,
    mode: target.mode,
    env: process.env,
  });
}

export async function resolveGatewayProbeAuth(cfg: GenesisConfig): Promise<{
  token?: string;
  password?: string;
}> {
  return (await resolveGatewayProbeAuthResolution(cfg)).auth;
}
