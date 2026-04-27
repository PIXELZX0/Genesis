/**
 * Standalone MCP server that exposes Genesis plugin-registered tools
 * (e.g. memory-lancedb's memory_recall, memory_store, memory_forget)
 * so ACP sessions running Claude Code can use them.
 *
 * Run via: node --import tsx src/mcp/plugin-tools-serve.ts
 * Or: bun src/mcp/plugin-tools-serve.ts
 */
import { pathToFileURL } from "node:url";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { AnyAgentTool } from "../agents/tools/common.js";
import { loadConfig } from "../config/config.js";
import type { GenesisConfig } from "../config/types.genesis.js";
import { formatErrorMessage } from "../infra/errors.js";
import { resolvePluginTools } from "../plugins/tools.js";
import { connectToolsMcpServerToStdio, createToolsMcpServer } from "./tools-stdio-server.js";

function resolveTools(config: GenesisConfig): AnyAgentTool[] {
  return resolvePluginTools({
    context: { config },
    suppressNameConflicts: true,
  });
}

export function createPluginToolsMcpServer(
  params: {
    config?: GenesisConfig;
    tools?: AnyAgentTool[];
  } = {},
): Server {
  const cfg = params.config ?? loadConfig();
  const tools = params.tools ?? resolveTools(cfg);
  return createToolsMcpServer({ name: "genesis-plugin-tools", tools });
}

export async function servePluginToolsMcp(): Promise<void> {
  const config = loadConfig();
  const tools = resolveTools(config);
  const server = createPluginToolsMcpServer({ config, tools });
  if (tools.length === 0) {
    process.stderr.write("plugin-tools-serve: no plugin tools found\n");
  }

  await connectToolsMcpServerToStdio(server);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  servePluginToolsMcp().catch((err) => {
    process.stderr.write(`plugin-tools-serve: ${formatErrorMessage(err)}\n`);
    process.exit(1);
  });
}
