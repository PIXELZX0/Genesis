export type McpServerMetadata = {
  name: string;
  url: string;
  transport: "streamable-http" | "sse";
  serverName?: string;
  serverVersion?: string;
  protocolVersion?: string;
  capabilities?: { tools?: string[]; prompts?: string[]; resources?: string[] };
  oauth: boolean;
  oauthIssuer?: string;
  oauthAuthorizeUrl?: string;
  oauthTokenUrl?: string;
  oauthScopes?: string[];
};

export type McpOAuthStartResult = {
  state: string;
  authorizeUrl: string;
  providerName?: string;
};

export type McpOAuthStatus = {
  connected: boolean;
  expiresAtMs?: number | null;
  providerName?: string;
  requiresAuth: boolean;
};

export type McpTestResult = {
  ok: boolean;
  message: string;
};
