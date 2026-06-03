import {
  listConfiguredMcpServers,
  setConfiguredMcpServer,
  unsetConfiguredMcpServer,
} from "../../config/mcp-config.js";
import {
  fetchMcpServerMetadata as fetchMetadata,
  completeMcpOAuthFlow,
  getStoredMcpOAuthStatus,
  listStoredMcpOAuthStatuses,
  setMcpServerConfigCache,
  startMcpOAuthFlow,
} from "../mcp-metadata.js";
import {
  deleteMcpOAuthToken,
  getMcpOAuthToken,
  pruneExpiredMcpOAuthStates,
} from "../mcp-oauth-store.js";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  type McpServerMetadataResult,
  type McpServerTestResult,
  type McpOAuthStartResult,
  type McpOAuthCallbackResult,
  type McpOAuthStatusResult,
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
} from "../protocol/index.js";
import type { GatewayRequestHandlers } from "./types.js";

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export type McpRuntime = {
  /** Base URL of the gateway web server (used to build OAuth redirect URI). */
  gatewayWebUrl: string;
  /** Resolves a client_id for a server; usually a stable Genesis identifier. */
  resolveClientId: (name: string) => string;
};

let _runtime: McpRuntime | null = null;
let _lastConfigCacheKey: string | null = null;

export function setMcpRuntime(runtime: McpRuntime): void {
  _runtime = runtime;
}

async function refreshServerConfigCache(): Promise<Record<string, Record<string, unknown>>> {
  const loaded = await listConfiguredMcpServers();
  if (!loaded.ok) {
    setMcpServerConfigCache(null);
    return {};
  }
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
      const result = await fetchMetadata(params.url);
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
    const token = getMcpOAuthToken(params.name);
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
        body: JSON.stringify({ jsonrpc: "2.0", id: 99, method: "ping" }),
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
          resolveClientId: (name) => _runtime!.resolveClientId(name),
        },
        params.name,
        server as never,
        params.scopes,
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
      const result = await completeMcpOAuthFlow(
        {
          gatewayWebUrl: _runtime.gatewayWebUrl,
          resolveClientId: (name) => _runtime!.resolveClientId(name),
        },
        { name: params.name, state: params.state, code: params.code },
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
    deleteMcpOAuthToken(params.name);
    respond(true, { ok: true } satisfies { ok: true }, undefined);
  },
};

export function listAllStoredMcpOAuthStatuses() {
  return listStoredMcpOAuthStatuses();
}
