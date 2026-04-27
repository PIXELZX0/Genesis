/**
 * Standalone MCP server for selected built-in Genesis tools.
 *
 * Run via: node --import tsx src/mcp/genesis-tools-serve.ts
 * Or: bun src/mcp/genesis-tools-serve.ts
 */
import { pathToFileURL } from "node:url";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { AnyAgentTool } from "../agents/tools/common.js";
import { createCronTool } from "../agents/tools/cron-tool.js";
import { formatErrorMessage } from "../infra/errors.js";
import { connectToolsMcpServerToStdio, createToolsMcpServer } from "./tools-stdio-server.js";

export function resolveGenesisToolsForMcp(): AnyAgentTool[] {
  return [createCronTool()];
}

export function createGenesisToolsMcpServer(
  params: {
    tools?: AnyAgentTool[];
  } = {},
): Server {
  const tools = params.tools ?? resolveGenesisToolsForMcp();
  return createToolsMcpServer({ name: "genesis-tools", tools });
}

export async function serveGenesisToolsMcp(): Promise<void> {
  const server = createGenesisToolsMcpServer();
  await connectToolsMcpServerToStdio(server);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  serveGenesisToolsMcp().catch((err) => {
    process.stderr.write(`genesis-tools-serve: ${formatErrorMessage(err)}\n`);
    process.exit(1);
  });
}
