import type { McpServerConfig } from "../config/types.mcp.js";
import { fetchWithSsrFGuard } from "../infra/net/fetch-guard.js";
import type { SsrFPolicy } from "../infra/net/ssrf.js";
import {
  buildMcpOAuthAuthorizeUrl,
  createMcpOAuthState,
  generatePkcePair,
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

const DEFAULT_FETCH_TIMEOUT_MS = 10_000;
const SSE_PROBE_TIMEOUT_MS = 3_000;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const CALLBACK_PATH = "/mcp-oauth-callback.html";

/**
 * Standard headers for a streamable-HTTP MCP request. Per the MCP spec the
 * client MUST include `MCP-Protocol-Version` on every initialize request and
 * `Accept` MUST advertise both `application/json` and `text/event-stream` so
 * the server can pick its preferred response shape.
 */
const STREAMABLE_HTTP_REQUEST_HEADERS: Record<string, string> = {
  "content-type": "application/json",
  accept: "application/json, text/event-stream",
  "mcp-protocol-version": MCP_PROTOCOL_VERSION,
};

function isStreamableHttpStatus(status: number): boolean {
  // 200 OK: success. 401/403: auth required. 406 Not Acceptable / 415
  // Unsupported Media Type: server speaks the protocol but rejects this
  // request shape — still a strong "this is an MCP endpoint" signal.
  return status === 200 || status === 401 || status === 403 || status === 406 || status === 415;
}

function jsonContentTypeOf(res: { headers: { get(name: string): string | null } }): string {
  return (res.headers.get("content-type") ?? "").toLowerCase();
}

function looksLikeMcpContentType(contentType: string): boolean {
  return contentType.includes("text/event-stream") || contentType.includes("application/json");
}

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

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type McpFetchOptions = {
  /** Override the HTTP client (tests inject a stub; bypasses the SSRF guard). */
  fetchImpl?: FetchLike;
  /**
   * Hostnames the operator has opted into for self-hosted MCP servers. These
   * skip the default private/internal-IP block (see `mcp.metadataFetch.allowedHosts`).
   */
  allowedHosts?: string[];
};

function statusHasNullBody(status: number): boolean {
  return status === 101 || status === 204 || status === 205 || status === 304;
}

/**
 * Build the default outbound HTTP client. All metadata/discovery/token requests
 * flow through {@link fetchWithSsrFGuard}, which pins DNS, blocks
 * private/internal/special-use addresses (unless allow-listed), follows
 * redirects safely, and applies a connect/total timeout. The full response body
 * is buffered (capped at {@link MAX_RESPONSE_BYTES}) so the pinned dispatcher can
 * be released immediately while preserving the `FetchLike` contract callers expect.
 */
function createGuardedFetch(allowedHosts?: string[]): FetchLike {
  const policy: SsrFPolicy | undefined =
    allowedHosts && allowedHosts.length > 0 ? { allowedHostnames: allowedHosts } : undefined;
  return async (input, init) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const { response, release } = await fetchWithSsrFGuard({
      url,
      init: init as RequestInit,
      timeoutMs: DEFAULT_FETCH_TIMEOUT_MS,
      policy,
      auditContext: "mcp-metadata",
    });
    try {
      if (statusHasNullBody(response.status)) {
        return new Response(null, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        });
      }
      const buf = Buffer.from(await response.arrayBuffer());
      if (buf.byteLength > MAX_RESPONSE_BYTES) {
        throw new Error(`MCP server response exceeds ${MAX_RESPONSE_BYTES}-byte cap`);
      }
      return new Response(buf, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    } finally {
      await release();
    }
  };
}

function resolveFetch(opts?: McpFetchOptions): FetchLike {
  return opts?.fetchImpl ?? createGuardedFetch(opts?.allowedHosts);
}

export async function fetchMcpServerMetadata(
  url: string,
  opts: McpFetchOptions = {},
): Promise<McpServerMetadata> {
  const fetchImpl = resolveFetch(opts);
  const normalized = normalizeUrl(url);
  const probed = await discoverEndpoints(normalized, fetchImpl);
  const endpoints = probed.endpoints;
  const transport = endpoints.transport;
  // Reuse the probe's response when the server already answered the spec
  // `initialize` handshake. This avoids a second round-trip for the common
  // case and lets us surface metadata even when the server only answers with
  // a JSON-RPC auth error (e.g. 401/403) — the URL-derived name is good
  // enough for the preview, and the OAuth probe can fill in the rest.
  let init: JsonRpcResponse<McpInitializeResult>;
  if (probed.initResponse) {
    init = probed.initResponse;
  } else if (probed.probeAccepted) {
    // The probe was answered with an MCP-shaped status (200/401/403/406/415)
    // but the body was not a usable JSON-RPC success — most likely an auth
    // challenge. We must not re-issue `initialize` against a server that
    // already rejected the same request; fall back to URL-derived metadata.
    init = { jsonrpc: "2.0", id: 1 };
  } else {
    init = await sendMcpRequest<McpInitializeResult>(
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
  }
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
  /**
   * Endpoint URL the server advertised for SSE-transport POSTs (the
   * `endpoint` event from the stream). Falls back to the GET URL when the
   * server never sends an explicit `endpoint` event.
   */
  ssePostUrl: string;
  /** Kept for diagnostic purposes; not consumed after discovery. */
  sseStream?: ReadableStream<Uint8Array>;
  transport: "streamable-http" | "sse";
};

type ProbeResult = {
  endpoints: DiscoveredEndpoints;
  /**
   * The `initialize` JSON-RPC response when the probe successfully parsed
   * one (200 OK only). Used to skip a redundant round-trip and to surface
   * metadata even when the server returns a JSON-RPC auth error.
   */
  initResponse: JsonRpcResponse<McpInitializeResult> | null;
  /**
   * `true` when the server answered the probe with an MCP-shaped status
   * (200/401/403/406/415) — i.e. it speaks the protocol but the body was
   * not a usable JSON-RPC success (auth challenge). The caller uses this to
   * avoid re-issuing `initialize` and to fall back to URL-derived metadata.
   */
  probeAccepted: boolean;
};

async function discoverEndpoints(url: string, fetchImpl: FetchLike): Promise<ProbeResult> {
  // Spec-defined capability probe: send the standard `initialize` handshake.
  // Per the MCP spec every compliant server MUST respond to `initialize`, and
  // `ping` is optional — many real servers omit it, which is why the previous
  // `ping`-based probe frequently fell through to the SSE GET and timed out.
  const post = await fetchImpl(url, {
    method: "POST",
    headers: STREAMABLE_HTTP_REQUEST_HEADERS,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: MCP_CLIENT_INFO,
      },
    }),
  });
  if (isStreamableHttpStatus(post.status)) {
    // A 200 OK without a recognizable MCP content-type is almost certainly
    // not an MCP endpoint (a generic web page, a 404 HTML page, etc.).
    if (post.status === 200 && !looksLikeMcpContentType(jsonContentTypeOf(post))) {
      const contentType = jsonContentTypeOf(post);
      throw new Error(
        `MCP server at ${url} returned an unexpected content-type: ${contentType || "(none)"}`,
      );
    }
    const initResponse = await readInitializeResponseIfPresent(post, url);
    return {
      endpoints: { baseUrl: url, ssePostUrl: url, transport: "streamable-http" },
      initResponse,
      probeAccepted: true,
    };
  }
  // 400/404/405/5xx → the URL is not a streamable-HTTP endpoint. Release the
  // POST body before opening a second connection.
  await post.body?.cancel();
  // Legacy SSE: GET with `text/event-stream` and an `endpoint` event.
  const sse = await fetchImpl(url, {
    method: "GET",
    headers: { accept: "text/event-stream" },
  });
  if (!sse.ok) {
    throw new Error(
      `Could not reach MCP server at ${url}: streamable-HTTP probe returned HTTP ${post.status}, SSE probe returned HTTP ${sse.status}.`,
    );
  }
  const sseContentType = jsonContentTypeOf(sse);
  if (!sseContentType.includes("text/event-stream") || !sse.body) {
    await sse.body?.cancel();
    throw new Error(
      `MCP server at ${url} did not advertise SSE transport (content-type: ${sseContentType || "(none)"}).`,
    );
  }
  // Read the first SSE event to confirm the server actually speaks SSE. We use
  // a short timeout so a streamable-HTTP server that ignored our POST and
  // returned a 200 + `text/event-stream` for GET (then idles) does not block
  // the whole `fetchWithSsrFGuard` budget.
  const endpointUrl = await readSseEndpointWithTimeout(sse.body, url, SSE_PROBE_TIMEOUT_MS);
  return {
    endpoints: {
      baseUrl: url,
      ssePostUrl: endpointUrl ?? url,
      sseStream: sse.body,
      transport: "sse",
    },
    initResponse: null,
    probeAccepted: false,
  };
}

/**
 * Try to parse a 200 OK `initialize` probe response. Returns `null` for the
 * auth-challenge codes (401/403/406/415) where the body is not a usable
 * JSON-RPC success, and silently swallows parse errors so the caller can
 * fall back to a fresh `initialize` request.
 */
async function readInitializeResponseIfPresent(
  res: Response,
  url: string,
): Promise<JsonRpcResponse<McpInitializeResult> | null> {
  if (res.status !== 200) {
    return null;
  }
  const contentType = jsonContentTypeOf(res);
  try {
    if (contentType.includes("text/event-stream")) {
      if (!res.body) {
        return null;
      }
      return await readJsonRpcFromSse<McpInitializeResult>(res.body, url, SSE_PROBE_TIMEOUT_MS);
    }
    if (contentType.includes("application/json")) {
      return (await res.json()) as JsonRpcResponse<McpInitializeResult>;
    }
  } catch {
    // Body is not a valid JSON-RPC payload — caller will re-issue initialize.
  }
  return null;
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
      headers: STREAMABLE_HTTP_REQUEST_HEADERS,
      body,
    });
    if (!res.ok) {
      throw new Error(`MCP request failed (${method}): HTTP ${res.status}`);
    }
    const contentType = jsonContentTypeOf(res);
    if (contentType.includes("text/event-stream")) {
      if (!res.body) {
        throw new Error(`MCP request ${method} returned SSE with no body`);
      }
      return await readJsonRpcFromSse<T>(res.body, endpoints.baseUrl, SSE_PROBE_TIMEOUT_MS);
    }
    return (await res.json()) as JsonRpcResponse<T>;
  }
  // SSE transport: POST to the `endpoint` URL announced by the server. The
  // spec says the POST response body is irrelevant; we discard it.
  const res = await fetchImpl(endpoints.ssePostUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
  if (!res.ok) {
    throw new Error(`MCP request failed (${method}): HTTP ${res.status}`);
  }
  await res.body?.cancel();
  return { jsonrpc: "2.0", id, result: {} as T };
}

type SseEvent = { event?: string; data?: string };

/**
 * Minimal SSE field parser. Supports multi-line `data:` (concatenated with
 * `\n`, matching the spec) but does not implement comments or id/retry
 * fields — we only need event/data for MCP discovery.
 */
function parseSseEvent(raw: string): SseEvent {
  const result: SseEvent = {};
  for (const line of raw.split("\n")) {
    if (line.startsWith("event:")) {
      const value = line.slice(6).trim();
      if (value) {
        result.event = value;
      }
    } else if (line.startsWith("data:")) {
      // Per the SSE spec, a single space after the colon is stripped.
      const value = line.slice(5).replace(/^ /, "");
      result.data = result.data ? `${result.data}\n${value}` : value;
    }
  }
  return result;
}

/**
 * Read SSE events from a stream until `predicate` returns a non-null value or
 * the stream closes. Bounded by `timeoutMs` to avoid hanging on a server that
 * opens an SSE stream but never sends a relevant event.
 */
async function readSseUntil<T>(
  reader: ReadableStreamDefaultReader<string>,
  predicate: (event: SseEvent) => T | null,
  timeoutMs: number,
  contextUrl: string,
): Promise<T | null> {
  let buffer = "";
  return await new Promise<T | null>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`SSE read from ${contextUrl} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    const cleanup = () => {
      clearTimeout(timer);
    };
    const read = async () => {
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) {
            cleanup();
            resolve(null);
            return;
          }
          buffer += value;
          let eventEnd = buffer.indexOf("\n\n");
          while (eventEnd !== -1) {
            const raw = buffer.slice(0, eventEnd);
            buffer = buffer.slice(eventEnd + 2);
            const event = parseSseEvent(raw);
            const match = predicate(event);
            if (match !== null && match !== undefined) {
              cleanup();
              resolve(match);
              return;
            }
            eventEnd = buffer.indexOf("\n\n");
          }
        }
      } catch (err) {
        cleanup();
        reject(err);
      }
    };
    void read();
  });
}

async function readJsonRpcFromSse<T>(
  body: ReadableStream<Uint8Array>,
  contextUrl: string,
  timeoutMs: number,
): Promise<JsonRpcResponse<T>> {
  const reader = decodeUtf8Stream(body).getReader();
  try {
    const data = await readSseUntil<string>(
      reader,
      (event) => (event.event === "message" && event.data ? event.data : null),
      timeoutMs,
      contextUrl,
    );
    if (!data) {
      throw new Error(`SSE stream from ${contextUrl} closed without a JSON-RPC response`);
    }
    return JSON.parse(data) as JsonRpcResponse<T>;
  } finally {
    await reader.cancel();
  }
}

async function readSseEndpointWithTimeout(
  body: ReadableStream<Uint8Array>,
  baseUrl: string,
  timeoutMs: number,
): Promise<string | null> {
  const reader = decodeUtf8Stream(body).getReader();
  try {
    return await readSseUntil<string>(
      reader,
      (event) => {
        if (event.event !== "endpoint" || !event.data) {
          return null;
        }
        try {
          return new URL(event.data, baseUrl).toString();
        } catch {
          return event.data;
        }
      },
      timeoutMs,
      baseUrl,
    );
  } finally {
    await reader.cancel();
  }
}

/**
 * Decode a byte stream into a UTF-8 string stream. Wraps `TextDecoder` in a
 * `TransformStream` so we can avoid the TS lib mismatch between
 * `ReadableStream<Uint8Array<ArrayBufferLike>>` (the shape of `Response.body`)
 * and `TextDecoderStream` (which types its writable side as
 * `WritableStream<BufferSource>`).
 */
function decodeUtf8Stream(body: ReadableStream<Uint8Array>): ReadableStream<string> {
  const decoder = new TextDecoder("utf-8");
  return body.pipeThrough(
    new TransformStream<Uint8Array, string>({
      transform(chunk, controller) {
        controller.enqueue(decoder.decode(chunk, { stream: true }));
      },
      flush(controller) {
        const tail = decoder.decode();
        if (tail) {
          controller.enqueue(tail);
        }
      },
    }),
  );
}

type OAuthProbe = {
  detected: boolean;
  issuer?: string;
  authorizeUrl?: string;
  tokenUrl?: string;
  scopes?: string[];
};

type AuthServerMetadata = {
  issuer?: string;
  authorization_endpoint?: string;
  token_endpoint?: string;
  revocation_endpoint?: string;
  scopes_supported?: string[];
};

async function readJsonSafe<T>(res: Response): Promise<T | null> {
  if (!res.ok) {
    return null;
  }
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** Try a list of authorization-server / OIDC metadata URLs; return the first hit. */
async function fetchAuthServerMetadata(
  candidates: string[],
  fetchImpl: FetchLike,
): Promise<OAuthProbe | null> {
  for (const candidate of candidates) {
    try {
      const res = await fetchImpl(candidate, { headers: { accept: "application/json" } });
      const meta = await readJsonSafe<AuthServerMetadata>(res);
      if (meta?.authorization_endpoint && meta.token_endpoint) {
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
  return null;
}

function wellKnownCandidates(issuerOrOrigin: string): string[] {
  let base: string;
  try {
    base = new URL(issuerOrOrigin).toString().replace(/\/$/, "");
  } catch {
    return [];
  }
  return [
    `${base}/.well-known/oauth-authorization-server`,
    `${base}/.well-known/openid-configuration`,
  ];
}

/**
 * RFC 9728 — fetch the OAuth Protected Resource metadata and return the first
 * advertised authorization server URL.
 */
async function fetchProtectedResourceAuthServer(
  resourceMetadataUrl: string,
  fetchImpl: FetchLike,
): Promise<{ authServer: string; scopes?: string[] } | null> {
  try {
    const res = await fetchImpl(resourceMetadataUrl, { headers: { accept: "application/json" } });
    const meta = await readJsonSafe<{
      authorization_servers?: string[];
      scopes_supported?: string[];
    }>(res);
    const authServer = meta?.authorization_servers?.find(
      (s) => typeof s === "string" && s.length > 0,
    );
    if (authServer) {
      return { authServer, scopes: meta?.scopes_supported };
    }
  } catch {
    // ignore
  }
  return null;
}

/** Parse a WWW-Authenticate Bearer challenge for the RFC 9728 `resource_metadata`. */
function parseResourceMetadataChallenge(header: string | null): string | null {
  if (!header) {
    return null;
  }
  const match = /resource_metadata="?([^",\s]+)"?/i.exec(header);
  return match ? match[1] : null;
}

/**
 * Probe a server that did not advertise standard well-known metadata: send an
 * `initialize`, and if it answers 401 / a JSON-RPC authorization error, treat
 * the server as OAuth-required and surface any `resource_metadata` hint.
 */
async function probeUnauthorizedChallenge(
  url: string,
  fetchImpl: FetchLike,
): Promise<{ challenged: boolean; resourceMetadataUrl?: string }> {
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: STREAMABLE_HTTP_REQUEST_HEADERS,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 0,
        method: "initialize",
        params: {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: MCP_CLIENT_INFO,
        },
      }),
    });
    if (res.status === 401) {
      return {
        challenged: true,
        resourceMetadataUrl:
          parseResourceMetadataChallenge(res.headers.get("www-authenticate")) ?? undefined,
      };
    }
    const body = await readJsonSafe<JsonRpcResponse<unknown>>(res);
    const message = body?.error?.message?.toLowerCase() ?? "";
    if (
      message.includes("missing_authorization") ||
      message.includes("unauthorized") ||
      message.includes("authorization required")
    ) {
      return { challenged: true };
    }
  } catch {
    // ignore
  }
  return { challenged: false };
}

async function probeOAuth(url: string, fetchImpl: FetchLike): Promise<OAuthProbe> {
  const origin = new URL(url).origin;

  // 1. Standard authorization-server / OIDC metadata under the origin.
  const direct = await fetchAuthServerMetadata(wellKnownCandidates(origin), fetchImpl);
  if (direct) {
    return direct;
  }

  // 2. RFC 9728 OAuth Protected Resource metadata -> authorization server.
  const protectedResource = await fetchProtectedResourceAuthServer(
    `${origin}/.well-known/oauth-protected-resource`,
    fetchImpl,
  );
  if (protectedResource) {
    const asMeta = await fetchAuthServerMetadata(
      wellKnownCandidates(protectedResource.authServer),
      fetchImpl,
    );
    if (asMeta) {
      return { ...asMeta, scopes: asMeta.scopes ?? protectedResource.scopes };
    }
  }

  // 3. Probe an `initialize`; a 401 / authorization error marks OAuth-required.
  const challenge = await probeUnauthorizedChallenge(url, fetchImpl);
  if (challenge.challenged) {
    const resourceMetadataUrl =
      challenge.resourceMetadataUrl ?? `${origin}/.well-known/oauth-protected-resource`;
    const hinted = await fetchProtectedResourceAuthServer(resourceMetadataUrl, fetchImpl);
    if (hinted) {
      const asMeta = await fetchAuthServerMetadata(
        wellKnownCandidates(hinted.authServer),
        fetchImpl,
      );
      if (asMeta) {
        return { ...asMeta, scopes: asMeta.scopes ?? hinted.scopes };
      }
    }
    // OAuth is required even though we could not resolve the AS metadata.
    return { detected: true };
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

export function redirectUriFor(gatewayWebUrl: string): string {
  return `${gatewayWebUrl.replace(/\/$/, "")}${CALLBACK_PATH}`;
}

/* ────────────────────────────  OAuth flow  ──────────────────────────── */

export type McpOAuthRuntime = {
  /** Base URL of the Gateway web server; used to build the redirect URI. */
  gatewayWebUrl: string;
  /** Stable client identity registered with the provider (per-server). */
  resolveClientId: (name: string, server: McpServerConfig) => string;
};

function authRecord(server: McpServerConfig): Record<string, unknown> {
  return (server.auth ?? {}) as Record<string, unknown>;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export async function startMcpOAuthFlow(
  runtime: McpOAuthRuntime,
  name: string,
  server: McpServerConfig,
  scopes?: string[],
): Promise<McpOAuthStartResult> {
  const auth = authRecord(server);
  const authorizeUrl = optionalString(auth.authorizeUrl);
  const tokenUrl = optionalString(auth.tokenUrl);
  const clientId = runtime.resolveClientId(name, server);
  const redirectUri = redirectUriFor(runtime.gatewayWebUrl);
  if (!authorizeUrl || !tokenUrl) {
    throw new Error(
      "Server config is missing authorizeUrl/tokenUrl. Add them under `mcp.servers.<name>.auth` or use the JSON tab.",
    );
  }
  // PKCE (S256) is on by default; opt out with `auth.usePkce: false`.
  const usePkce = auth.usePkce !== false;
  const pkce = usePkce ? generatePkcePair() : null;
  const state = createMcpOAuthState({
    name,
    scopes,
    codeVerifier: pkce?.codeVerifier,
  });
  const url = buildMcpOAuthAuthorizeUrl({
    authorizeUrl,
    clientId,
    redirectUri,
    state,
    scopes: scopes ?? (Array.isArray(auth.scopes) ? (auth.scopes as string[]) : undefined),
    codeChallenge: pkce?.codeChallenge,
    codeChallengeMethod: pkce ? "S256" : undefined,
  });
  return {
    state,
    authorizeUrl: url,
    providerName: optionalString(auth.providerName),
  };
}

export type McpOAuthCompleteInput = {
  name: string;
  state: string;
  code: string;
};

function buildTokenRequestHeaders(clientId: string, clientSecret?: string): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": "application/x-www-form-urlencoded",
    accept: "application/json",
  };
  if (clientSecret) {
    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    headers.authorization = `Basic ${basic}`;
  }
  return headers;
}

type TokenEndpointPayload = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
};

export async function completeMcpOAuthFlow(
  runtime: McpOAuthRuntime,
  input: McpOAuthCompleteInput,
  opts: McpFetchOptions = {},
): Promise<{ ok: boolean; message?: string; providerName?: string; expiresAtMs?: number | null }> {
  const record = consumeMcpOAuthState(input.state);
  if (!record || record.name !== input.name) {
    return { ok: false, message: "OAuth state expired or invalid. Restart the flow." };
  }
  const server = lookupServerConfig(input.name);
  if (!server) {
    return { ok: false, message: `No MCP server named "${input.name}" configured.` };
  }
  const auth = authRecord(server);
  const tokenUrl = optionalString(auth.tokenUrl);
  const clientId = runtime.resolveClientId(input.name, server);
  const clientSecret = optionalString(auth.clientSecret);
  const redirectUri = redirectUriFor(runtime.gatewayWebUrl);
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
  // Use the PKCE verifier bound to this authorization request's state.
  if (record.codeVerifier) {
    params.set("code_verifier", record.codeVerifier);
  }
  const fetchImpl = resolveFetch(opts);
  const res = await fetchImpl(tokenUrl, {
    method: "POST",
    headers: buildTokenRequestHeaders(clientId, clientSecret),
    body: params.toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return {
      ok: false,
      message: `Token endpoint returned HTTP ${res.status}: ${text.slice(0, 200)}`,
    };
  }
  const payload = (await res.json()) as TokenEndpointPayload;
  if (!payload.access_token) {
    return { ok: false, message: "Token endpoint did not return an access_token." };
  }
  const token: McpOAuthTokenRecord = {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    expiresAtMs:
      typeof payload.expires_in === "number" ? Date.now() + payload.expires_in * 1000 : undefined,
    providerName: optionalString(auth.providerName),
    scopes: payload.scope ? payload.scope.split(/\s+/).filter(Boolean) : undefined,
    tokenUrl,
    revokeUrl: optionalString(auth.revokeUrl),
  };
  setMcpOAuthToken(input.name, token);
  return {
    ok: true,
    providerName: token.providerName,
    expiresAtMs: token.expiresAtMs ?? null,
  };
}

export type McpOAuthRefreshResult = {
  ok: boolean;
  message?: string;
  expiresAtMs?: number | null;
};

/**
 * Exchange a stored refresh token for a fresh access token (RFC 6749 §6).
 * Returns `{ ok: false }` (without throwing) when no refresh token is stored or
 * the provider rejects the request, so callers can fall back to "requires auth".
 */
export async function refreshMcpOAuthToken(
  name: string,
  server: McpServerConfig,
  params: { clientId: string } & McpFetchOptions,
): Promise<McpOAuthRefreshResult> {
  const stored = getMcpOAuthToken(name);
  if (!stored?.refreshToken) {
    return { ok: false, message: "No refresh token stored." };
  }
  const auth = authRecord(server);
  const tokenUrl = stored.tokenUrl ?? optionalString(auth.tokenUrl);
  if (!tokenUrl) {
    return { ok: false, message: "No token endpoint to refresh against." };
  }
  const clientSecret = optionalString(auth.clientSecret);
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: stored.refreshToken,
    client_id: params.clientId,
  });
  if (clientSecret) {
    body.set("client_secret", clientSecret);
  }
  const fetchImpl = resolveFetch(params);
  let res: Response;
  try {
    res = await fetchImpl(tokenUrl, {
      method: "POST",
      headers: buildTokenRequestHeaders(params.clientId, clientSecret),
      body: body.toString(),
    });
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return { ok: false, message: `Refresh failed: HTTP ${res.status} ${text.slice(0, 200)}` };
  }
  const payload = (await res.json().catch(() => null)) as TokenEndpointPayload | null;
  if (!payload?.access_token) {
    return { ok: false, message: "Refresh response did not include an access_token." };
  }
  const next: McpOAuthTokenRecord = {
    ...stored,
    accessToken: payload.access_token,
    // RFC 6749 §6: a new refresh token may be issued; otherwise keep the old one.
    refreshToken: payload.refresh_token ?? stored.refreshToken,
    expiresAtMs:
      typeof payload.expires_in === "number" ? Date.now() + payload.expires_in * 1000 : undefined,
    scopes: payload.scope ? payload.scope.split(/\s+/).filter(Boolean) : stored.scopes,
    tokenUrl,
  };
  setMcpOAuthToken(name, next);
  return { ok: true, expiresAtMs: next.expiresAtMs ?? null };
}

const REFRESH_SKEW_MS = 60 * 1000;

function tokenNeedsRefresh(token: McpOAuthTokenRecord, skewMs = REFRESH_SKEW_MS): boolean {
  return (
    typeof token.expiresAtMs === "number" &&
    token.expiresAtMs - Date.now() <= skewMs &&
    Boolean(token.refreshToken)
  );
}

/**
 * Opportunistically refresh a stored token when it is within {@link REFRESH_SKEW_MS}
 * of expiry. Returns the freshest stored token (refreshed or original). Never
 * throws — refresh failures leave the existing token in place.
 */
export async function ensureFreshMcpOAuthToken(
  name: string,
  server: McpServerConfig,
  params: { clientId: string } & McpFetchOptions,
): Promise<McpOAuthTokenRecord | null> {
  const current = getMcpOAuthToken(name);
  if (!current || !tokenNeedsRefresh(current)) {
    return current;
  }
  await refreshMcpOAuthToken(name, server, params);
  return getMcpOAuthToken(name);
}

/**
 * Best-effort RFC 7009 token revocation. Never throws; revocation failures must
 * not block disconnect.
 */
export async function revokeMcpOAuthToken(
  name: string,
  server: McpServerConfig,
  params: { clientId: string } & McpFetchOptions,
): Promise<{ revoked: boolean }> {
  const stored = getMcpOAuthToken(name);
  const auth = authRecord(server);
  const revokeUrl = stored?.revokeUrl ?? optionalString(auth.revokeUrl);
  const tokenToRevoke = stored?.refreshToken ?? stored?.accessToken;
  if (!revokeUrl || !tokenToRevoke) {
    return { revoked: false };
  }
  const clientSecret = optionalString(auth.clientSecret);
  const body = new URLSearchParams({
    token: tokenToRevoke,
    client_id: params.clientId,
  });
  if (clientSecret) {
    body.set("client_secret", clientSecret);
  }
  try {
    const fetchImpl = resolveFetch(params);
    await fetchImpl(revokeUrl, {
      method: "POST",
      headers: buildTokenRequestHeaders(params.clientId, clientSecret),
      body: body.toString(),
    });
    return { revoked: true };
  } catch {
    return { revoked: false };
  }
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
