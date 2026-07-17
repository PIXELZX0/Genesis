import {
  listConfiguredMcpServers,
  setConfiguredMcpServer,
  unsetConfiguredMcpServer,
} from "../../config/mcp-config.js";
import type { McpServerConfig } from "../../config/types.mcp.js";
import { logInfo } from "../../logger.js";
import {
  fetchMcpServerMetadata as fetchMetadata,
  completeMcpOAuthFlow,
  ensureFreshMcpOAuthToken,
  getStoredMcpOAuthStatus,
  listStoredMcpOAuthStatuses,
  redirectUriFor,
  refreshMcpOAuthToken,
  revokeMcpOAuthToken,
  setMcpServerConfigCache,
  startMcpOAuthFlow,
} from "../mcp-metadata.js";
import {
  cancelEmbeddedOAuth,
  type EmbeddedInputEvent,
  inputEmbeddedOAuth,
  normalizeViewport,
  pollEmbeddedOAuth,
  resolveChromiumPath,
  startEmbeddedOAuth,
} from "../mcp-oauth-embedded.js";
import { deleteMcpOAuthToken, pruneExpiredMcpOAuthStates } from "../mcp-oauth-store.js";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  type McpServerMetadataResult,
  type McpServerTestResult,
  type McpOAuthStartResult,
  type McpOAuthCallbackResult,
  type McpOAuthStatusResult,
  type McpOAuthRefreshResult,
  type McpServersResult,
  validateMcpServerSetParams,
  validateMcpServerUnsetParams,
  validateMcpServersListParams,
  validateMcpServerMetadataParams,
  validateMcpServerTestParams,
  validateMcpOAuthStartParams,
  validateMcpOAuthCallbackParams,
  validateMcpOAuthStatusParams,
  validateMcpOAuthDisconnectParams,
  validateMcpOAuthRefreshParams,
  validateMcpOAuthEmbeddedStartParams,
  validateMcpOAuthEmbeddedPollParams,
  validateMcpOAuthEmbeddedInputParams,
  validateMcpOAuthEmbeddedCancelParams,
  type McpOAuthEmbeddedStartResult,
  type McpOAuthEmbeddedPollResult,
  type McpOAuthEmbeddedInputResult,
  type McpOAuthEmbeddedCancelResult,
} from "../protocol/index.js";
import type { GatewayRequestHandlers } from "./types.js";

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// Google (and some other IdPs) reject sign-in from an automated/embedded
// browser outright ("Error 403: disallowed_useragent") — no puppeteer flag
// works around it, so route these straight to the real-browser popup flow
// instead of burning a doomed headless session.
const EMBEDDED_OAUTH_BLOCKED_HOSTS = new Set(["accounts.google.com"]);

function isEmbeddedOAuthBlocked(authorizeUrl: string): boolean {
  try {
    return EMBEDDED_OAUTH_BLOCKED_HOSTS.has(new URL(authorizeUrl).hostname);
  } catch {
    return false;
  }
}

export type McpRuntime = {
  /** Base URL of the gateway web server (used to build OAuth redirect URI). */
  gatewayWebUrl: string;
  /** Resolves a client_id for a server; usually a stable Genesis identifier. */
  resolveClientId: (name: string) => string;
};

let _runtime: McpRuntime | null = null;
let _lastConfigCacheKey: string | null = null;
let _allowedHosts: string[] = [];
let _embeddedChromiumPath: string | undefined;

const DEFAULT_MCP_CLIENT_ID = "genesis-control-ui";

export function setMcpRuntime(runtime: McpRuntime): void {
  _runtime = runtime;
}

/** Whether the OAuth runtime has been wired by gateway startup. */
export function isMcpRuntimeConfigured(): boolean {
  return _runtime !== null;
}

/**
 * Resolve the OAuth `client_id` for a server. Prefers the provider-registered
 * id from `auth.clientId`, then the gateway runtime's resolver, then a constant.
 */
function resolveClientIdFor(name: string, server?: Record<string, unknown>): string {
  const auth = server?.auth;
  if (auth && typeof auth === "object") {
    const clientId = (auth as Record<string, unknown>).clientId;
    if (typeof clientId === "string" && clientId.length > 0) {
      return clientId;
    }
  }
  return _runtime ? _runtime.resolveClientId(name) : DEFAULT_MCP_CLIENT_ID;
}

function normalizeAllowedHosts(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
}

/**
 * Strip secrets before a server config is written to logs: OAuth client secret
 * and any bearer/authorization headers. Mirrors the redaction intent of
 * `src/config/redact-snapshot`.
 */
export function redactMcpServerConfigForLog(
  server: Record<string, unknown>,
): Record<string, unknown> {
  const clone: Record<string, unknown> = { ...server };
  if (clone.auth && typeof clone.auth === "object") {
    const auth = { ...(clone.auth as Record<string, unknown>) };
    if ("clientSecret" in auth) {
      auth.clientSecret = "[redacted]";
    }
    clone.auth = auth;
  }
  if (clone.headers && typeof clone.headers === "object") {
    const headers = { ...(clone.headers as Record<string, unknown>) };
    for (const key of Object.keys(headers)) {
      if (key.toLowerCase() === "authorization") {
        headers[key] = "[redacted]";
      }
    }
    clone.headers = headers;
  }
  return clone;
}

async function refreshServerConfigCache(): Promise<Record<string, Record<string, unknown>>> {
  const loaded = await listConfiguredMcpServers();
  if (!loaded.ok) {
    setMcpServerConfigCache(null);
    return {};
  }
  _allowedHosts = normalizeAllowedHosts(loaded.config?.mcp?.metadataFetch?.allowedHosts);
  const configuredChromium = loaded.config?.mcp?.embeddedOAuth?.chromiumPath;
  _embeddedChromiumPath = typeof configuredChromium === "string" ? configuredChromium : undefined;
  const cacheKey = JSON.stringify(loaded.mcpServers);
  if (_lastConfigCacheKey !== cacheKey) {
    setMcpServerConfigCache(loaded.mcpServers as never);
    _lastConfigCacheKey = cacheKey;
  }
  return loaded.mcpServers;
}

export const mcpHandlers: GatewayRequestHandlers = {
  "mcp.servers.list": async ({ params, respond }) => {
    if (!validateMcpServersListParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid mcp.servers.list params: ${formatValidationErrors(validateMcpServersListParams.errors)}`,
        ),
      );
      return;
    }
    const loaded = await listConfiguredMcpServers();
    if (!loaded.ok) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, loaded.error));
      return;
    }
    respond(
      true,
      { path: loaded.path, servers: loaded.mcpServers } satisfies McpServersResult,
      undefined,
    );
  },
  "mcp.servers.set": async ({ params, respond }) => {
    if (!validateMcpServerSetParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid mcp.servers.set params: ${formatValidationErrors(validateMcpServerSetParams.errors)}`,
        ),
      );
      return;
    }
    const result = await setConfiguredMcpServer({ name: params.name, server: params.server });
    if (!result.ok) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, result.error));
      return;
    }
    logInfo(
      `mcp: server "${params.name}" configured ${JSON.stringify(
        redactMcpServerConfigForLog(params.server as Record<string, unknown>),
      )}`,
    );
    setMcpServerConfigCache(result.mcpServers as never);
    _lastConfigCacheKey = JSON.stringify(result.mcpServers);
    respond(
      true,
      { path: result.path, servers: result.mcpServers } satisfies McpServersResult,
      undefined,
    );
  },
  "mcp.servers.unset": async ({ params, respond }) => {
    if (!validateMcpServerUnsetParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid mcp.servers.unset params: ${formatValidationErrors(validateMcpServerUnsetParams.errors)}`,
        ),
      );
      return;
    }
    const result = await unsetConfiguredMcpServer({ name: params.name });
    if (!result.ok) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, result.error));
      return;
    }
    setMcpServerConfigCache(result.mcpServers as never);
    _lastConfigCacheKey = JSON.stringify(result.mcpServers);
    respond(
      true,
      {
        path: result.path,
        servers: result.mcpServers,
        removed: result.removed ?? false,
      } satisfies McpServersResult,
      undefined,
    );
  },
  "mcp.servers.metadata": async ({ params, respond }) => {
    if (!validateMcpServerMetadataParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid mcp.servers.metadata params: ${formatValidationErrors(validateMcpServerMetadataParams.errors)}`,
        ),
      );
      return;
    }
    try {
      await refreshServerConfigCache();
      const result = await fetchMetadata(params.url, { allowedHosts: _allowedHosts });
      respond(true, result satisfies McpServerMetadataResult, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, getErrorMessage(err)));
    }
  },
  "mcp.servers.test": async ({ params, respond }) => {
    if (!validateMcpServerTestParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid mcp.servers.test params: ${formatValidationErrors(validateMcpServerTestParams.errors)}`,
        ),
      );
      return;
    }
    const servers = await refreshServerConfigCache();
    const server = servers[params.name];
    if (!server) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `No MCP server named "${params.name}".`),
      );
      return;
    }
    const url = typeof server.url === "string" ? server.url : null;
    if (!url) {
      respond(
        true,
        {
          ok: false,
          message: "Server has no URL; nothing to probe.",
        } satisfies McpServerTestResult,
        undefined,
      );
      return;
    }
    const token = await ensureFreshMcpOAuthToken(params.name, server as McpServerConfig, {
      clientId: resolveClientIdFor(params.name, server),
      allowedHosts: _allowedHosts,
    });
    const headers: Record<string, string> = {
      accept: "application/json, text/event-stream",
    };
    if (token?.accessToken) {
      headers.authorization = `Bearer ${token.accessToken}`;
    }
    if (server.headers && typeof server.headers === "object") {
      for (const [key, value] of Object.entries(server.headers)) {
        if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
          headers[key] = String(value);
        }
      }
    }
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 99,
          method: "initialize",
          params: {
            protocolVersion: "2024-11-05",
            capabilities: {},
            clientInfo: { name: "genesis-control-ui", version: "0.0.0" },
          },
        }),
      });
      if (res.ok || res.status === 406 || res.status === 415) {
        respond(
          true,
          {
            ok: true,
            message: `Server responded (HTTP ${res.status}).`,
          } satisfies McpServerTestResult,
          undefined,
        );
        return;
      }
      respond(
        true,
        { ok: false, message: `Server returned HTTP ${res.status}.` } satisfies McpServerTestResult,
        undefined,
      );
    } catch (err) {
      respond(
        true,
        { ok: false, message: getErrorMessage(err) } satisfies McpServerTestResult,
        undefined,
      );
    }
  },
  "mcp.oauth.start": async ({ params, respond }) => {
    if (!validateMcpOAuthStartParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid mcp.oauth.start params: ${formatValidationErrors(validateMcpOAuthStartParams.errors)}`,
        ),
      );
      return;
    }
    if (!_runtime) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.UNAVAILABLE,
          "MCP OAuth runtime is not configured. Set a gateway web URL in the server config.",
        ),
      );
      return;
    }
    const servers = await refreshServerConfigCache();
    const server = servers[params.name];
    if (!server) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `No MCP server named "${params.name}".`),
      );
      return;
    }
    try {
      pruneExpiredMcpOAuthStates();
      const result = await startMcpOAuthFlow(
        {
          gatewayWebUrl: _runtime.gatewayWebUrl,
          resolveClientId: (name, srv) => resolveClientIdFor(name, srv as Record<string, unknown>),
        },
        params.name,
        server as never,
        params.scopes,
        { allowedHosts: _allowedHosts },
      );
      respond(true, result satisfies McpOAuthStartResult, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, getErrorMessage(err)));
    }
  },
  "mcp.oauth.callback": async ({ params, respond }) => {
    if (!validateMcpOAuthCallbackParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid mcp.oauth.callback params: ${formatValidationErrors(validateMcpOAuthCallbackParams.errors)}`,
        ),
      );
      return;
    }
    if (!_runtime) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.UNAVAILABLE,
          "MCP OAuth runtime is not configured. Set a gateway web URL in the server config.",
        ),
      );
      return;
    }
    try {
      await refreshServerConfigCache();
      const result = await completeMcpOAuthFlow(
        {
          gatewayWebUrl: _runtime.gatewayWebUrl,
          resolveClientId: (name, srv) => resolveClientIdFor(name, srv as Record<string, unknown>),
        },
        { name: params.name, state: params.state, code: params.code },
        { allowedHosts: _allowedHosts },
      );
      respond(true, result satisfies McpOAuthCallbackResult, undefined);
    } catch (err) {
      respond(
        true,
        { ok: false, message: getErrorMessage(err) } satisfies McpOAuthCallbackResult,
        undefined,
      );
    }
  },
  "mcp.oauth.status": async ({ params, respond }) => {
    if (!validateMcpOAuthStatusParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid mcp.oauth.status params: ${formatValidationErrors(validateMcpOAuthStatusParams.errors)}`,
        ),
      );
      return;
    }
    const servers = await refreshServerConfigCache();
    const server = servers[params.name];
    if (server) {
      await ensureFreshMcpOAuthToken(params.name, server as McpServerConfig, {
        clientId: resolveClientIdFor(params.name),
        allowedHosts: _allowedHosts,
      });
    }
    const status = getStoredMcpOAuthStatus(params.name);
    respond(true, status satisfies McpOAuthStatusResult, undefined);
  },
  "mcp.oauth.disconnect": async ({ params, respond }) => {
    if (!validateMcpOAuthDisconnectParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid mcp.oauth.disconnect params: ${formatValidationErrors(validateMcpOAuthDisconnectParams.errors)}`,
        ),
      );
      return;
    }
    // Best-effort RFC 7009 revocation before dropping the local token. Failures
    // never block disconnect.
    const servers = await refreshServerConfigCache();
    const server = servers[params.name];
    if (server) {
      await revokeMcpOAuthToken(params.name, server as McpServerConfig, {
        clientId: resolveClientIdFor(params.name),
        allowedHosts: _allowedHosts,
      });
    }
    deleteMcpOAuthToken(params.name);
    respond(true, { ok: true } satisfies { ok: true }, undefined);
  },
  "mcp.oauth.refresh": async ({ params, respond }) => {
    if (!validateMcpOAuthRefreshParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid mcp.oauth.refresh params: ${formatValidationErrors(validateMcpOAuthRefreshParams.errors)}`,
        ),
      );
      return;
    }
    const servers = await refreshServerConfigCache();
    const server = servers[params.name];
    if (!server) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `No MCP server named "${params.name}".`),
      );
      return;
    }
    const result = await refreshMcpOAuthToken(params.name, server as McpServerConfig, {
      clientId: resolveClientIdFor(params.name, server),
      allowedHosts: _allowedHosts,
    });
    respond(true, result satisfies McpOAuthRefreshResult, undefined);
  },
  "mcp.oauth.embedded.start": async ({ params, client, respond }) => {
    if (!validateMcpOAuthEmbeddedStartParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid mcp.oauth.embedded.start params: ${formatValidationErrors(validateMcpOAuthEmbeddedStartParams.errors)}`,
        ),
      );
      return;
    }
    if (!_runtime) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.UNAVAILABLE,
          "MCP OAuth runtime is not configured. Set a gateway web URL in the server config.",
        ),
      );
      return;
    }
    const connId = client?.connId;
    if (!connId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "Embedded OAuth requires a connected client."),
      );
      return;
    }
    const servers = await refreshServerConfigCache();
    const server = servers[params.name];
    if (!server) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `No MCP server named "${params.name}".`),
      );
      return;
    }
    const chromiumPath = resolveChromiumPath(_embeddedChromiumPath);
    if (!chromiumPath) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.UNAVAILABLE,
          "Embedded OAuth is unavailable: no Chromium executable found on this gateway. Use the popup flow instead.",
        ),
      );
      return;
    }
    const gatewayWebUrl = _runtime.gatewayWebUrl;
    const allowedHosts = _allowedHosts;
    try {
      pruneExpiredMcpOAuthStates();
      const flow = await startMcpOAuthFlow(
        {
          gatewayWebUrl,
          resolveClientId: (name, srv) => resolveClientIdFor(name, srv as Record<string, unknown>),
        },
        params.name,
        server as never,
        params.scopes,
        { allowedHosts },
      );
      if (isEmbeddedOAuthBlocked(flow.authorizeUrl)) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.UNAVAILABLE,
            "This provider blocks sign-in from an automated browser. Use the popup flow instead.",
          ),
        );
        return;
      }
      const viewport = normalizeViewport(params.viewport);
      const result = await startEmbeddedOAuth({
        connId,
        name: params.name,
        authorizeUrl: flow.authorizeUrl,
        oauthState: flow.state,
        chromiumPath,
        redirectUriPrefix: redirectUriFor(gatewayWebUrl),
        viewport,
        providerName: flow.providerName,
        onComplete: (args) =>
          completeMcpOAuthFlow(
            {
              gatewayWebUrl,
              resolveClientId: (name, srv) =>
                resolveClientIdFor(name, srv as Record<string, unknown>),
            },
            args,
            { allowedHosts },
          ),
      });
      respond(true, result satisfies McpOAuthEmbeddedStartResult, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, getErrorMessage(err)));
    }
  },
  "mcp.oauth.embedded.poll": async ({ params, respond }) => {
    if (!validateMcpOAuthEmbeddedPollParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid mcp.oauth.embedded.poll params: ${formatValidationErrors(validateMcpOAuthEmbeddedPollParams.errors)}`,
        ),
      );
      return;
    }
    const poll = await pollEmbeddedOAuth(params.sessionId);
    if (!poll) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "No such embedded OAuth session."),
      );
      return;
    }
    respond(true, poll satisfies McpOAuthEmbeddedPollResult, undefined);
  },
  "mcp.oauth.embedded.input": async ({ params, respond }) => {
    if (!validateMcpOAuthEmbeddedInputParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid mcp.oauth.embedded.input params: ${formatValidationErrors(validateMcpOAuthEmbeddedInputParams.errors)}`,
        ),
      );
      return;
    }
    const event = toEmbeddedInputEvent(params);
    if (!event) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "Malformed embedded OAuth input event."),
      );
      return;
    }
    const ok = await inputEmbeddedOAuth(params.sessionId, event);
    respond(true, { ok } satisfies McpOAuthEmbeddedInputResult, undefined);
  },
  "mcp.oauth.embedded.cancel": async ({ params, respond }) => {
    if (!validateMcpOAuthEmbeddedCancelParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid mcp.oauth.embedded.cancel params: ${formatValidationErrors(validateMcpOAuthEmbeddedCancelParams.errors)}`,
        ),
      );
      return;
    }
    const ok = cancelEmbeddedOAuth(params.sessionId);
    respond(true, { ok } satisfies McpOAuthEmbeddedCancelResult, undefined);
  },
};

/**
 * Translate a validated `mcp.oauth.embedded.input` payload into the registry's
 * discriminated input event, or `null` when required fields are missing.
 */
function toEmbeddedInputEvent(params: {
  kind: "mouse" | "wheel" | "key";
  action?: "move" | "down" | "up" | "click" | "press" | "type";
  x?: number;
  y?: number;
  button?: "left" | "right" | "middle";
  deltaX?: number;
  deltaY?: number;
  text?: string;
  key?: string;
}): EmbeddedInputEvent | null {
  if (params.kind === "mouse") {
    const action = params.action;
    if (
      (action === "move" || action === "down" || action === "up" || action === "click") &&
      typeof params.x === "number" &&
      typeof params.y === "number"
    ) {
      return { kind: "mouse", action, x: params.x, y: params.y, button: params.button };
    }
    return null;
  }
  if (params.kind === "wheel") {
    if (
      typeof params.x === "number" &&
      typeof params.y === "number" &&
      typeof params.deltaX === "number" &&
      typeof params.deltaY === "number"
    ) {
      return {
        kind: "wheel",
        x: params.x,
        y: params.y,
        deltaX: params.deltaX,
        deltaY: params.deltaY,
      };
    }
    return null;
  }
  if (params.action === "type" && typeof params.text === "string") {
    return { kind: "key", action: "type", text: params.text };
  }
  if (params.action === "press" && typeof params.key === "string") {
    return { kind: "key", action: "press", key: params.key };
  }
  return null;
}

export function listAllStoredMcpOAuthStatuses() {
  return listStoredMcpOAuthStatuses();
}
