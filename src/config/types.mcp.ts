export type McpServerConfig = {
  /** Stdio transport: command to spawn. */
  command?: string;
  /** Stdio transport: arguments for the command. */
  args?: string[];
  /** Environment variables passed to the server process (stdio only). */
  env?: Record<string, string | number | boolean>;
  /** Working directory for stdio server. */
  cwd?: string;
  /** Alias for cwd. */
  workingDirectory?: string;
  /** HTTP transport: URL of the remote MCP server (http or https). */
  url?: string;
  /** HTTP transport type for remote MCP servers. */
  transport?: "sse" | "streamable-http";
  /** HTTP transport: extra HTTP headers sent with every request. */
  headers?: Record<string, string | number | boolean>;
  /** Optional connection timeout in milliseconds. */
  connectionTimeoutMs?: number;
  [key: string]: unknown;
};

export type McpConfig = {
  /** Named MCP server definitions managed by Genesis. */
  servers?: Record<string, McpServerConfig>;
  /**
   * Idle TTL for session-scoped bundled MCP runtimes, in milliseconds.
   *
   * Defaults to 10 minutes. Set to 0 to disable idle eviction.
   */
  sessionIdleTtlMs?: number;
  /**
   * Controls for outbound metadata/OAuth discovery fetches (Control UI
   * "Add by link" and the OAuth flow). These requests are SSRF-guarded and
   * block private/internal addresses by default.
   */
  metadataFetch?: {
    /**
     * Hostnames the operator trusts for self-hosted MCP servers. Listing a host
     * here exempts it from the default private/internal-IP block so a gateway on
     * a private network can reach an internal MCP server. Empty by default.
     */
    allowedHosts?: string[];
  };
  /**
   * Embedded (server-side headless-browser) OAuth flow. When a Chromium is
   * available the Control UI can drive an in-gateway browser instead of opening
   * the provider's authorize URL in the operator's own browser. Optional and
   * capability-gated; falls back to the popup flow when unavailable.
   */
  embeddedOAuth?: {
    /**
     * Explicit path to a Chromium/Chrome executable. When unset, the gateway
     * probes `PUPPETEER_EXECUTABLE_PATH`/`CHROME_PATH` and platform defaults.
     */
    chromiumPath?: string;
  };
};
