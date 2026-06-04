import type { GatewayBrowserClient } from "../gateway.ts";

export type McpServersMap = Record<string, Record<string, unknown>>;

export type McpMessage = { kind: "success" | "error"; text: string };

/**
 * Structural subset of the app view-state consumed by the MCP controller.
 * Mirrors the pattern used by {@link ../controllers/skills.ts}.
 */
export type McpState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  mcpServersLoading: boolean;
  mcpServers: McpServersMap | null;
  mcpServersPath: string | null;
  mcpServersError: string | null;
  mcpBusy: boolean;
  mcpMessage: McpMessage | null;
  mcpDraftName: string;
  mcpDraftConfig: string;
  mcpAuthToken: string;
  mcpLinkUrl: string;
  mcpLinkMetadataLoading: boolean;
  mcpLinkMetadataError: string | null;
  mcpLinkMetadata: McpServerMetadata | null;
  mcpOAuthStatus: Record<string, McpOAuthStatus>;
  mcpOAuthFlow: McpOAuthFlow | null;
  mcpOAuthPopup: Window | null;
  mcpTestStatus: Record<string, { ok: boolean; message: string } | null>;
};

export type McpServerMetadata = {
  /** Server name suggested by the server (serverInfo.name) or derived from URL. */
  name: string;
  /** Endpoint URL the metadata was fetched from. */
  url: string;
  /** Detected MCP transport. */
  transport: "streamable-http" | "sse";
  /** Optional serverInfo.name. */
  serverName?: string;
  /** Optional serverInfo.version. */
  serverVersion?: string;
  /** Optional protocolVersion advertised. */
  protocolVersion?: string;
  /** Optional list of tool/prompt/resource names advertised by the server. */
  capabilities?: { tools?: string[]; prompts?: string[]; resources?: string[] };
  /** Whether the server advertised OAuth metadata. */
  oauth: boolean;
  /** Issuer URL advertised by the server (for OAuth dynamic registration). */
  oauthIssuer?: string;
  /** Authorization endpoint URL discovered for OAuth. */
  oauthAuthorizeUrl?: string;
  /** Token endpoint URL discovered for OAuth. */
  oauthTokenUrl?: string;
  /** Optional list of scopes advertised in OAuth metadata. */
  oauthScopes?: string[];
};

export type McpOAuthStatus = {
  /** Server has stored tokens and the access token is not expired. */
  connected: boolean;
  /** Epoch ms when the access token expires, if known. */
  expiresAtMs?: number | null;
  /** Server name from the provider. */
  providerName?: string;
  /** Whether the server requires re-auth. */
  requiresAuth: boolean;
};

export type McpOAuthFlow = {
  /** Server name being authorized. */
  name: string;
  /** State nonce to validate in the callback. */
  state: string;
  /** Authorize URL the user should open. */
  authorizeUrl: string;
  /** Epoch ms when this flow was started. */
  startedAtMs: number;
  /** Optional provider name. */
  providerName?: string;
  /** Optional error message. */
  error?: string;
};

type McpServersResult = {
  path: string;
  servers: McpServersMap;
  removed?: boolean;
};

type McpMetadataResult = McpServerMetadata;

type McpOAuthStartResult = {
  state: string;
  authorizeUrl: string;
  providerName?: string;
};

type McpOAuthCallbackResult = {
  ok: boolean;
  message?: string;
  providerName?: string;
  expiresAtMs?: number | null;
};

type McpOAuthStatusResult = McpOAuthStatus;

type McpTestResult = {
  ok: boolean;
  message: string;
};

const getErrorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

export async function loadMcpServers(state: McpState) {
  if (!state.client || !state.connected || state.mcpServersLoading) {
    return;
  }
  state.mcpServersLoading = true;
  state.mcpServersError = null;
  try {
    const res = await state.client.request<McpServersResult>("mcp.servers.list", {});
    state.mcpServers = res?.servers ?? {};
    state.mcpServersPath = res?.path ?? null;
  } catch (err) {
    state.mcpServersError = getErrorMessage(err);
  } finally {
    state.mcpServersLoading = false;
  }
}

export async function saveMcpServer(
  state: McpState,
  name: string,
  server: Record<string, unknown>,
) {
  if (!state.client || !state.connected) {
    return;
  }
  const trimmed = name.trim();
  if (!trimmed) {
    state.mcpMessage = { kind: "error", text: "MCP server name is required." };
    return;
  }
  state.mcpBusy = true;
  state.mcpMessage = null;
  try {
    const res = await state.client.request<McpServersResult>("mcp.servers.set", {
      name: trimmed,
      server,
    });
    state.mcpServers = res?.servers ?? state.mcpServers;
    state.mcpServersPath = res?.path ?? state.mcpServersPath;
    state.mcpMessage = { kind: "success", text: `Saved MCP server "${trimmed}".` };
    state.mcpDraftName = "";
    state.mcpDraftConfig = "";
    state.mcpAuthToken = "";
  } catch (err) {
    state.mcpMessage = { kind: "error", text: getErrorMessage(err) };
  } finally {
    state.mcpBusy = false;
  }
}

export async function deleteMcpServer(state: McpState, name: string) {
  if (!state.client || !state.connected) {
    return;
  }
  state.mcpBusy = true;
  state.mcpMessage = null;
  try {
    const res = await state.client.request<McpServersResult>("mcp.servers.unset", { name });
    state.mcpServers = res?.servers ?? state.mcpServers;
    state.mcpServersPath = res?.path ?? state.mcpServersPath;
    state.mcpMessage =
      res?.removed === false
        ? { kind: "error", text: `No MCP server named "${name}".` }
        : { kind: "success", text: `Removed MCP server "${name}".` };
  } catch (err) {
    state.mcpMessage = { kind: "error", text: getErrorMessage(err) };
  } finally {
    state.mcpBusy = false;
  }
}

export async function fetchMcpServerMetadata(
  state: McpState,
  rawUrl: string,
): Promise<McpServerMetadata | null> {
  if (!state.client || !state.connected) {
    return null;
  }
  const url = rawUrl.trim();
  if (!url) {
    state.mcpLinkMetadataError = "Enter a server URL.";
    return null;
  }
  state.mcpLinkMetadataLoading = true;
  state.mcpLinkMetadataError = null;
  try {
    const res = await state.client.request<McpMetadataResult>("mcp.servers.metadata", { url });
    state.mcpLinkMetadata = res;
    return res;
  } catch (err) {
    state.mcpLinkMetadataError = getErrorMessage(err);
    state.mcpLinkMetadata = null;
    return null;
  } finally {
    state.mcpLinkMetadataLoading = false;
  }
}

export async function testMcpServer(state: McpState, name: string) {
  if (!state.client || !state.connected) {
    return;
  }
  try {
    const res = await state.client.request<McpTestResult>("mcp.servers.test", { name });
    state.mcpTestStatus = {
      ...state.mcpTestStatus,
      [name]: { ok: res?.ok ?? false, message: res?.message ?? "" },
    };
  } catch (err) {
    state.mcpTestStatus = {
      ...state.mcpTestStatus,
      [name]: { ok: false, message: getErrorMessage(err) },
    };
  }
}

export async function loadMcpOAuthStatuses(state: McpState) {
  if (!state.client || !state.connected) {
    return;
  }
  const servers = state.mcpServers ?? {};
  const names = Object.keys(servers);
  const next: Record<string, McpOAuthStatus> = {};
  await Promise.all(
    names.map(async (name) => {
      try {
        const res = await state.client!.request<McpOAuthStatusResult>("mcp.oauth.status", { name });
        next[name] = res;
      } catch {
        next[name] = { connected: false, requiresAuth: false };
      }
    }),
  );
  state.mcpOAuthStatus = next;
}

export async function startMcpOAuth(
  state: McpState,
  name: string,
  scopes?: string[],
): Promise<McpOAuthFlow | null> {
  if (!state.client || !state.connected) {
    return null;
  }
  try {
    const res = await state.client.request<McpOAuthStartResult>("mcp.oauth.start", {
      name,
      scopes,
    });
    const flow: McpOAuthFlow = {
      name,
      state: res.state,
      authorizeUrl: res.authorizeUrl,
      startedAtMs: Date.now(),
      providerName: res.providerName,
    };
    state.mcpOAuthFlow = flow;
    return flow;
  } catch (err) {
    state.mcpMessage = { kind: "error", text: `OAuth start failed: ${getErrorMessage(err)}` };
    return null;
  }
}

export async function completeMcpOAuth(
  state: McpState,
  code: string,
  oauthState: string,
): Promise<boolean> {
  if (!state.client || !state.connected) {
    return false;
  }
  const flow = state.mcpOAuthFlow;
  if (!flow) {
    return false;
  }
  if (flow.state !== oauthState) {
    state.mcpMessage = { kind: "error", text: "OAuth state mismatch; restart the flow." };
    state.mcpOAuthFlow = null;
    return false;
  }
  try {
    const res = await state.client.request<McpOAuthCallbackResult>("mcp.oauth.callback", {
      name: flow.name,
      state: oauthState,
      code,
    });
    if (res?.ok) {
      state.mcpOAuthStatus = {
        ...state.mcpOAuthStatus,
        [flow.name]: {
          connected: true,
          requiresAuth: false,
          providerName: res.providerName ?? flow.providerName,
          expiresAtMs: res.expiresAtMs ?? null,
        },
      };
      state.mcpMessage = {
        kind: "success",
        text: `Connected to "${flow.name}".`,
      };
    } else {
      state.mcpMessage = {
        kind: "error",
        text: res?.message ?? "OAuth callback failed.",
      };
    }
    state.mcpOAuthFlow = null;
    return res?.ok ?? false;
  } catch (err) {
    state.mcpMessage = { kind: "error", text: `OAuth failed: ${getErrorMessage(err)}` };
    state.mcpOAuthFlow = null;
    return false;
  }
}

export async function disconnectMcpOAuth(state: McpState, name: string) {
  if (!state.client || !state.connected) {
    return;
  }
  try {
    await state.client.request("mcp.oauth.disconnect", { name });
    state.mcpOAuthStatus = {
      ...state.mcpOAuthStatus,
      [name]: { connected: false, requiresAuth: false },
    };
    state.mcpMessage = { kind: "success", text: `Disconnected "${name}".` };
  } catch (err) {
    state.mcpMessage = { kind: "error", text: getErrorMessage(err) };
  }
}

export function cancelMcpOAuth(state: McpState) {
  if (state.mcpOAuthPopup && !state.mcpOAuthPopup.closed) {
    try {
      state.mcpOAuthPopup.close();
    } catch {
      // ignore
    }
  }
  state.mcpOAuthPopup = null;
  state.mcpOAuthFlow = null;
}
