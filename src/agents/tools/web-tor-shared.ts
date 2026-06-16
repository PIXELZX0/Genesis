import type { GenesisConfig } from "../../config/types.genesis.js";

export type WebTorConfig = {
  enabled?: boolean;
  mode?: "external";
  socksHost?: string;
  socksPort?: number;
};

export function resolveWebTorConfig(cfg?: GenesisConfig): WebTorConfig | undefined {
  const webConfig = cfg?.tools?.web;
  if (!webConfig || typeof webConfig !== "object") {
    return undefined;
  }
  const torConfig = (webConfig as Record<string, unknown>).tor;
  if (!torConfig || typeof torConfig !== "object") {
    return undefined;
  }
  return torConfig as WebTorConfig;
}

export function resolveWebTorProxyUrl(config?: GenesisConfig): string | undefined {
  const tor = resolveWebTorConfig(config);
  if (!tor || tor.enabled !== true) {
    return undefined;
  }
  const host = typeof tor.socksHost === "string" && tor.socksHost ? tor.socksHost : "127.0.0.1";
  const rawPort =
    typeof tor.socksPort === "number" && Number.isFinite(tor.socksPort) ? tor.socksPort : 9050;
  const port = Math.max(1, Math.min(65535, Math.floor(rawPort)));
  const bracketedHost = host.includes(":") ? `[${host}]` : host;
  return `socks5://${bracketedHost}:${port}`;
}
