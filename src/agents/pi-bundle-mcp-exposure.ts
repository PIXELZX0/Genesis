import type { GenesisConfig } from "../config/types.genesis.js";

export type McpToolExposure = "cli" | "inject";

/** Default is `cli`: MCP tools are reached through `genesis mcp`, not injected into the tool list. */
export function resolveMcpToolExposure(cfg?: GenesisConfig): McpToolExposure {
  return cfg?.mcp?.toolExposure === "inject" ? "inject" : "cli";
}

const FENCE = "```";

/**
 * System prompt section for `cli` exposure. Lists configured server names only
 * (sorted, no connection) so the section stays byte-stable for prompt caching.
 */
export function buildMcpCliUsageSection(serverNames: Iterable<string>): string | undefined {
  const names = Array.from(new Set(serverNames), (name) =>
    name.replaceAll(/[\r\n\t`]+/gu, " ").trim(),
  )
    .filter(Boolean)
    .toSorted((a, b) => a.localeCompare(b));
  if (names.length === 0) {
    return undefined;
  }
  return [
    "## MCP Servers (via CLI)",
    "MCP tools are not loaded into your tool list. Use the `genesis mcp` CLI from the shell tool when you need one.",
    "",
    `Configured servers: ${names.join(", ")}`,
    "",
    FENCE + "bash",
    "genesis mcp tools <server> [--json]      # list a server's tools and input schemas",
    "genesis mcp call <server> <tool> '<json-args>' [--json]   # call one tool",
    FENCE,
    "",
  ].join("\n");
}
