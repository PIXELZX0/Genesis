import type { McpServerConfig } from "../config/types.mcp.js";
import {
  buildMcpOAuthAuthorizeUrl,
  createMcpOAuthState,
  getMcpOAuthToken,
  setMcpOAuthToken,
  consumeMcpOAuthState,
  listMcpOAuthTokens,
  type McpOAuthTokenRecord,
} from "./mcp-oauth-store.js";
import type { McpServerMetadata, McpOAuthStartResult } from "./mcp-oauth-types.js";

/**
 * Lightweight JSON-RPC client used to probe a remote MCP server for its
 * `initialize` handshake. Uses the standard MCP `initialize` + `tools/list`
 * (when available) requests; the server is expected to support the MCP
 * streamable HTTP or SSE transport.
 */
const MCP_PROTOCOL_VERSION = "2024-11-05";
const MCP_CLIENT_INFO = { name: "genesis-control-ui", version: "0.0.0" };

type JsonRpcResponse<T> = {
  jsonrpc?: "2.0";
  id?: number | string | null;
  result?: T;
  error?: { code: number; message: string; data?: unknown };
};

type McpInitializeResult = {
  protocolVersion?: string;
  serverInfo?: { name?: string; version?: string };
  capabilities?: {
    tools?: Record<string, unknown>;
    prompts?: Record<string, unknown>;
    resources?: Record<string, unknown>;
  };
};

type McpToolsListResult = {
  tools?: Array<{ name: string }>;
};

type McpPromptsListResult = {
  prompts?: Array<{ name: string }>;
};

type McpResourcesListResult = {
  resources?: Array<{ name: string }>;
};

type FetchLike = typeof fetch;

export async function fetchMcpServerMetadata(
  url: string,
  fetchImpl: FetchLike = fetch,
): Promise<McpServerMetadata> {
  const normalized = normalizeUrl(url);
  const endpoints = await discoverEndpoints(normalized, fetchImpl);
  const transport = endpoints.transport;
  const init = await sendMcpRequest<McpInitializeResult>(
    endpoints,
    1,
    "initialize",
    {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: MCP_CLIENT_INFO,
    },
    fetchImpl,
  );
  const capabilities: McpServerMetadata["capabilities"] = {};
  if (init.result?.capabilities?.tools) {
    try {
      const tools = await sendMcpRequest<McpToolsListResult>(
        endpoints,
        2,
        "tools/list",
        {},
        fetchImpl,
      );
      capabilities.tools = (tools.result?.tools ?? []).map((t) => t.name);
    } catch {
      // optional
    }
  }
  if (init.result?.capabilities?.prompts) {
    try {
      const prompts = await sendMcpRequest<McpPromptsListResult>(
        endpoints,
        3,
        "prompts/list",
        {},
        fetchImpl,
      );
      capabilities.prompts = (prompts.result?.prompts ?? []).map((p) => p.name);
    } catch {
      // optional
    }
  }
  if (init.result?.capabilities?.resources) {
    try {
      const resources = await sendMcpRequest<McpResourcesListResult>(
        endpoints,
        4,
        "resources/list",
        {},
        fetchImpl,
      );
      capabilities.resources = (resources.result?.resources ?? []).map((r) => r.name);
    } catch {
      // optional
    }
  }

  const oauth = await probeOAuth(normalized, fetchImpl);
  const suggestedName =
    init.result?.serverInfo?.name?.toLowerCase().replace(/[^a-z0-9-]+/g, "-") ?? "";
  return {
    name: suggestedName || deriveNameFromUrl(normalized),
    url: normalized,
    transport,
    serverName: init.result?.serverInfo?.name,
    serverVersion: init.result?.serverInfo?.version,
    protocolVersion: init.result?.protocolVersion,
    capabilities: Object.keys(capabilities).length > 0 ? capabilities : undefined,
    oauth: oauth.detected,
    oauthIssuer: oauth.issuer,
    oauthAuthorizeUrl: oauth.authorizeUrl,
    oauthTokenUrl: oauth.tokenUrl,
    oauthScopes: oauth.scopes,
  };
}

type DiscoveredEndpoints = {
  baseUrl: string;
  /** Last response, kept for streamable SSE parsing. */
  sseStream?: ReadableStream<Uint8Array>;
  transport: "streamable-http" | "sse";
};

async function discoverEndpoints(url: string, fetchImpl: FetchLike): Promise<DiscoveredEndpoints> {
  // First, try streamable-HTTP POST + accept event-stream.
  const post = await fetchImpl(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 0,
      method: "ping",
    }),
  });
  if (post.ok || post.status === 406 || post.status === 415) {
    return { baseUrl: url, transport: "streamable-http" };
  }
  // Fall back to legacy SSE: GET with text/event-stream and an `endpoint` event.
  const sse = await fetchImpl(url, {
    method: "GET",
    headers: { accept: "text/event-stream" },
  });
  if (sse.ok && sse.body) {
    return { baseUrl: url, transport: "sse", sseStream: sse.body };
  }
  throw new Error(`Could not reach MCP server at ${url} (HTTP ${post.status}).`);
}

async function sendMcpRequest<T>(
  endpoints: DiscoveredEndpoints,
  id: number,
  method: string,
  params: unknown,
  fetchImpl: FetchLike,
): Promise<JsonRpcResponse<T>> {
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id,
    method,
    params,
  });
  if (endpoints.transport === "streamable-http") {
    const res = await fetchImpl(endpoints.baseUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body,
    });
    if (!res.ok) {
      throw new Error(`MCP request failed (${method}): HTTP ${res.status}`);
    }
    return (await res.json()) as JsonRpcResponse<T>;
  }
  // SSE transport: send a POST to the `endpoint` URL announced by the server.
  // For simplicity, the URL is the same as the GET endpoint.
  const res = await fetchImpl(endpoints.baseUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
  if (!res.ok) {
    throw new Error(`MCP request failed (${method}): HTTP ${res.status}`);
  }
  return (await res.json()) as JsonRpcResponse<T>;
}

type OAuthProbe = {
  detected: boolean;
  issuer?: string;
  authorizeUrl?: string;
  tokenUrl?: string;
  scopes?: string[];
};

async function probeOAuth(url: string, fetchImpl: FetchLike): Promise<OAuthProbe> {
  const origin = new URL(url).origin;
  const candidates = [
    `${origin}/.well-known/oauth-authorization-server`,
    `${origin}/.well-known/openid-configuration`,
  ];
  for (const candidate of candidates) {
    try {
      const res = await fetchImpl(candidate, { headers: { accept: "application/json" } });
      if (!res.ok) {
        continue;
      }
      const meta = (await res.json()) as {
        issuer?: string;
        authorization_endpoint?: string;
        token_endpoint?: string;
        scopes_supported?: string[];
      };
      if (meta.authorization_endpoint && meta.token_endpoint) {
        return {
          detected: true,
          issuer: meta.issuer,
          authorizeUrl: meta.authorization_endpoint,
          tokenUrl: meta.token_endpoint,
          scopes: meta.scopes_supported,
        };
      }
    } catch {
      // try next
    }
  }
  return { detected: false };
}

function normalizeUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("Server URL is required.");
  }
  const url = new URL(trimmed);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Server URL must use http or https.");
  }
  return url.toString();
}

function deriveNameFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
    return host || "mcp-server";
  } catch {
    return "mcp-server";
  }
}

/* ────────────────────────────  OAuth flow  ──────────────────────────── */

export type McpOAuthRuntime = {
  /** Base URL of the Gateway web server; used to build the redirect URI. */
  gatewayWebUrl: string;
  /** Stable client identity registered with the provider (per-server). */
  resolveClientId: (name: string, server: McpServerConfig) => string;
};

export async function startMcpOAuthFlow(
  runtime: McpOAuthRuntime,
  name: string,
  server: McpServerConfig,
  scopes?: string[],
): Promise<McpOAuthStartResult> {
  const auth = (server.auth ?? {}) as Record<string, unknown>;
  const authorizeUrl = typeof auth.authorizeUrl === "string" ? auth.authorizeUrl : null;
  const tokenUrl = typeof auth.tokenUrl === "string" ? auth.tokenUrl : null;
  const clientId = runtime.resolveClientId(name, server);
  const redirectUri = `${runtime.gatewayWebUrl.replace(/\/$/, "")}/__genesis__/mcp-oauth-callback.html`;
  if (!authorizeUrl || !tokenUrl) {
    throw new Error(
      "Server config is missing authorizeUrl/tokenUrl. Add them under `mcp.servers.<name>.auth` or use the JSON tab.",
    );
  }
  const state = createMcpOAuthState({ name, scopes });
  const url = buildMcpOAuthAuthorizeUrl({
    authorizeUrl,
    clientId,
    redirectUri,
    state,
    scopes: scopes ?? (Array.isArray(auth.scopes) ? (auth.scopes as string[]) : undefined),
  });
  return {
    state,
    authorizeUrl: url,
    providerName: typeof auth.providerName === "string" ? auth.providerName : undefined,
  };
}

export type McpOAuthCompleteInput = {
  name: string;
  state: string;
  code: string;
};

export async function completeMcpOAuthFlow(
  runtime: McpOAuthRuntime,
  input: McpOAuthCompleteInput,
): Promise<{ ok: boolean; message?: string; providerName?: string; expiresAtMs?: number | null }> {
  const record = consumeMcpOAuthState(input.state);
  if (!record || record.name !== input.name) {
    return { ok: false, message: "OAuth state expired or invalid. Restart the flow." };
  }
  const server = lookupServerConfig(input.name);
  if (!server) {
    return { ok: false, message: `No MCP server named "${input.name}" configured.` };
  }
  const auth = (server.auth ?? {}) as Record<string, unknown>;
  const tokenUrl = typeof auth.tokenUrl === "string" ? auth.tokenUrl : null;
  const clientId = runtime.resolveClientId(input.name, server);
  const clientSecret = typeof auth.clientSecret === "string" ? auth.clientSecret : undefined;
  const redirectUri = `${runtime.gatewayWebUrl.replace(/\/$/, "")}/__genesis__/mcp-oauth-callback.html`;
  if (!tokenUrl) {
    return { ok: false, message: "Server config is missing `auth.tokenUrl`." };
  }
  const params = new URLSearchParams({
    grant_type: "authorization_code",
    code: input.code,
    client_id: clientId,
    redirect_uri: redirectUri,
  });
  if (clientSecret) {
    params.set("client_secret", clientSecret);
  }
  if (auth.codeVerifier && typeof auth.codeVerifier === "string") {
    params.set("code_verifier", auth.codeVerifier);
  }
  const headers: Record<string, string> = {
    "content-type": "application/x-www-form-urlencoded",
    accept: "application/json",
  };
  if (clientSecret) {
    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    headers.authorization = `Basic ${basic}`;
  }
  const res = await fetch(tokenUrl, {
    method: "POST",
    headers,
    body: params.toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return {
      ok: false,
      message: `Token endpoint returned HTTP ${res.status}: ${text.slice(0, 200)}`,
    };
  }
  const payload = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    token_type?: string;
  };
  if (!payload.access_token) {
    return { ok: false, message: "Token endpoint did not return an access_token." };
  }
  const token: McpOAuthTokenRecord = {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    expiresAtMs:
      typeof payload.expires_in === "number" ? Date.now() + payload.expires_in * 1000 : undefined,
    providerName: typeof auth.providerName === "string" ? auth.providerName : undefined,
    scopes: payload.scope ? payload.scope.split(/\s+/).filter(Boolean) : undefined,
  };
  setMcpOAuthToken(input.name, token);
  return {
    ok: true,
    providerName: token.providerName,
    expiresAtMs: token.expiresAtMs ?? null,
  };
}

export function getStoredMcpOAuthStatus(name: string): {
  connected: boolean;
  requiresAuth: boolean;
  expiresAtMs?: number | null;
  providerName?: string;
} {
  const token = getMcpOAuthToken(name);
  if (!token) {
    return { connected: false, requiresAuth: false };
  }
  const expired =
    typeof token.expiresAtMs === "number" && token.expiresAtMs <= Date.now() && !token.refreshToken;
  if (expired) {
    return { connected: false, requiresAuth: true, providerName: token.providerName };
  }
  return {
    connected: true,
    requiresAuth: false,
    expiresAtMs: token.expiresAtMs ?? null,
    providerName: token.providerName,
  };
}

export function listStoredMcpOAuthStatuses(): Record<
  string,
  { connected: boolean; requiresAuth: boolean; expiresAtMs?: number | null; providerName?: string }
> {
  const tokens = listMcpOAuthTokens();
  const out: Record<
    string,
    {
      connected: boolean;
      requiresAuth: boolean;
      expiresAtMs?: number | null;
      providerName?: string;
    }
  > = {};
  for (const [name, token] of Object.entries(tokens)) {
    const expired =
      typeof token.expiresAtMs === "number" &&
      token.expiresAtMs <= Date.now() &&
      !token.refreshToken;
    if (expired) {
      out[name] = { connected: false, requiresAuth: true, providerName: token.providerName };
    } else {
      out[name] = {
        connected: true,
        requiresAuth: false,
        expiresAtMs: token.expiresAtMs ?? null,
        providerName: token.providerName,
      };
    }
  }
  return out;
}

/**
 * In-memory cache to avoid re-reading the config for every OAuth call. The
 * caller (the gateway server method) is responsible for invalidating this when
 * the underlying config changes.
 */
let _serverConfigCache: { value: Record<string, McpServerConfig> | null } = { value: null };
export function setMcpServerConfigCache(servers: Record<string, McpServerConfig> | null): void {
  _serverConfigCache.value = servers;
}
function lookupServerConfig(name: string): McpServerConfig | null {
  if (!_serverConfigCache.value) {
    return null;
  }
  return _serverConfigCache.value[name] ?? null;
}
