/**
 * MCP server presets — one-click configs for popular hosted MCP servers.
 *
 * OAuth presets save a bare url + transport (plus `auth: { type: "oauth" }` so
 * the list shows a Connect button) and rely on the existing OAuth flow. Bearer
 * presets attach the operator-supplied token as an Authorization header.
 */

export type McpPresetAuthKind = "oauth" | "bearer" | "none";

export type McpPreset = {
  /** Stable id used for selection state. */
  id: string;
  /** Suggested server name (config key). */
  name: string;
  /** Display label (proper noun; not translated). */
  label: string;
  /** One-line description. */
  description: string;
  /** Emoji/icon shown on the card. */
  icon: string;
  /** Remote MCP endpoint. */
  url: string;
  /** MCP transport. */
  transport: "streamable-http" | "sse";
  /** How the server authenticates. */
  authKind: McpPresetAuthKind;
  /** Label for the token input (bearer presets only). */
  tokenLabel?: string;
  /** Header name carrying the token. Defaults to "Authorization". */
  tokenHeader?: string;
  /** Value prefix for the token. Defaults to "Bearer ". */
  tokenPrefix?: string;
  /** Where the operator can create the token. */
  tokenDocsUrl?: string;
};

export const MCP_PRESETS: McpPreset[] = [
  {
    id: "notion",
    name: "notion",
    label: "Notion",
    description: "Search, read, and update Notion pages and databases.",
    icon: "📝",
    url: "https://mcp.notion.com/mcp",
    transport: "streamable-http",
    authKind: "oauth",
  },
  {
    id: "linear",
    name: "linear",
    label: "Linear",
    description: "Manage Linear issues, projects, and cycles.",
    icon: "📐",
    url: "https://mcp.linear.app/mcp",
    transport: "streamable-http",
    authKind: "oauth",
  },
  {
    id: "sentry",
    name: "sentry",
    label: "Sentry",
    description: "Inspect Sentry issues, events, and releases.",
    icon: "🛡️",
    url: "https://mcp.sentry.dev/mcp",
    transport: "streamable-http",
    authKind: "oauth",
  },
  {
    id: "github",
    name: "github",
    label: "GitHub",
    description: "Repositories, issues, and pull requests via a personal access token.",
    icon: "🐙",
    url: "https://api.githubcopilot.com/mcp/",
    transport: "streamable-http",
    authKind: "bearer",
    tokenLabel: "GitHub personal access token",
    tokenDocsUrl: "https://github.com/settings/personal-access-tokens",
  },
  {
    id: "context7",
    name: "context7",
    label: "Context7",
    description: "Up-to-date library and framework documentation.",
    icon: "📚",
    url: "https://mcp.context7.com/mcp",
    transport: "streamable-http",
    authKind: "none",
  },
];

export function getMcpPresetById(id: string | null | undefined): McpPreset | undefined {
  if (!id) {
    return undefined;
  }
  return MCP_PRESETS.find((p) => p.id === id);
}

/**
 * Attach a bearer token as an HTTP header, preserving any existing headers.
 * Empty/whitespace tokens are ignored so the saved config stays clean.
 */
export function withBearerToken(
  config: Record<string, unknown>,
  token: string,
  opts?: { header?: string; prefix?: string },
): Record<string, unknown> {
  const trimmed = token.trim();
  if (!trimmed) {
    return config;
  }
  const header = opts?.header ?? "Authorization";
  const prefix = opts?.prefix ?? "Bearer ";
  const existing =
    config.headers && typeof config.headers === "object" && !Array.isArray(config.headers)
      ? (config.headers as Record<string, unknown>)
      : {};
  return { ...config, headers: { ...existing, [header]: `${prefix}${trimmed}` } };
}

/** Build the server config for a preset, attaching a token for bearer presets. */
export function buildMcpPresetConfig(preset: McpPreset, token: string): Record<string, unknown> {
  const config: Record<string, unknown> = { url: preset.url, transport: preset.transport };
  if (preset.authKind === "oauth") {
    config.auth = { type: "oauth" };
    return config;
  }
  if (preset.authKind === "bearer") {
    return withBearerToken(config, token, {
      header: preset.tokenHeader,
      prefix: preset.tokenPrefix,
    });
  }
  return config;
}
