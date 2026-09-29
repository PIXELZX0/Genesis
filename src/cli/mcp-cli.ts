import crypto from "node:crypto";
import { Command } from "commander";
import type { SessionMcpRuntime } from "../agents/pi-bundle-mcp-types.js";
import { parseConfigValue } from "../auto-reply/reply/config-value.js";
import {
  listConfiguredMcpServers,
  setConfiguredMcpServer,
  unsetConfiguredMcpServer,
} from "../config/mcp-config.js";
import { loadConfig } from "../config/config.js";
import { serveGenesisChannelMcp } from "../mcp/channel-server.js";
import { defaultRuntime } from "../runtime.js";
import {
  normalizeLowercaseStringOrEmpty,
  normalizeStringifiedOptionalString,
} from "../shared/string-coerce.js";
import { resolveGatewayAuthOptions } from "./gateway-secret-options.js";

function fail(message: string): never {
  defaultRuntime.error(message);
  defaultRuntime.exit(1);
  throw new Error(message);
}

async function withMcpRuntime<T>(
  fn: (runtime: SessionMcpRuntime) => Promise<T>,
): Promise<T> {
  const { createSessionMcpRuntime } = await import("../agents/pi-bundle-mcp-runtime.js");
  const runtime = createSessionMcpRuntime({
    sessionId: `mcp-cli:${crypto.randomUUID()}`,
    workspaceDir: process.cwd(),
    cfg: loadConfig(),
  });
  try {
    return await fn(runtime);
  } finally {
    await runtime.dispose();
  }
}

function printJson(value: unknown): void {
  defaultRuntime.writeJson(value);
}

export function registerMcpCli(program: Command) {
  const mcp = program.command("mcp").description("Manage Genesis MCP config and channel bridge");

  mcp
    .command("serve")
    .description("Expose Genesis channels over MCP stdio")
    .option("--url <url>", "Gateway WebSocket URL (defaults to gateway.remote.url when configured)")
    .option("--token <token>", "Gateway token (if required)")
    .option("--token-file <path>", "Read gateway token from file")
    .option("--password <password>", "Gateway password (if required)")
    .option("--password-file <path>", "Read gateway password from file")
    .option(
      "--claude-channel-mode <mode>",
      "Claude channel notification mode: auto, on, or off",
      "auto",
    )
    .option("-v, --verbose", "Verbose logging to stderr", false)
    .action(async (opts) => {
      try {
        const { gatewayToken, gatewayPassword } = resolveGatewayAuthOptions(opts);
        const claudeChannelMode = normalizeLowercaseStringOrEmpty(
          normalizeStringifiedOptionalString(opts.claudeChannelMode) ?? "auto",
        );
        if (
          claudeChannelMode !== "auto" &&
          claudeChannelMode !== "on" &&
          claudeChannelMode !== "off"
        ) {
          throw new Error("Invalid --claude-channel-mode value. Use auto, on, or off.");
        }
        await serveGenesisChannelMcp({
          gatewayUrl: opts.url as string | undefined,
          gatewayToken,
          gatewayPassword,
          claudeChannelMode,
          verbose: Boolean(opts.verbose),
        });
      } catch (err) {
        defaultRuntime.error(String(err));
        defaultRuntime.exit(1);
      }
    });

  mcp
    .command("list")
    .description("List configured MCP servers")
    .option("--json", "Print JSON")
    .action(async (opts: { json?: boolean }) => {
      const loaded = await listConfiguredMcpServers();
      if (!loaded.ok) {
        fail(loaded.error);
      }
      if (opts.json) {
        printJson(loaded.mcpServers);
        return;
      }
      const names = Object.keys(loaded.mcpServers).toSorted();
      if (names.length === 0) {
        defaultRuntime.log(`No MCP servers configured in ${loaded.path}.`);
        return;
      }
      defaultRuntime.log(`MCP servers (${loaded.path}):`);
      for (const name of names) {
        defaultRuntime.log(`- ${name}`);
      }
    });

  mcp
    .command("show")
    .description("Show one configured MCP server or the full MCP config")
    .argument("[name]", "MCP server name")
    .option("--json", "Print JSON")
    .action(async (name: string | undefined, opts: { json?: boolean }) => {
      const loaded = await listConfiguredMcpServers();
      if (!loaded.ok) {
        fail(loaded.error);
      }
      const value = name ? loaded.mcpServers[name] : loaded.mcpServers;
      if (name && !value) {
        fail(`No MCP server named "${name}" in ${loaded.path}.`);
      }
      if (opts.json) {
        printJson(value ?? {});
        return;
      }
      if (name) {
        defaultRuntime.log(`MCP server "${name}" (${loaded.path}):`);
      } else {
        defaultRuntime.log(`MCP servers (${loaded.path}):`);
      }
      printJson(value ?? {});
    });

  mcp
    .command("set")
    .description("Set one configured MCP server from a JSON object")
    .argument("<name>", "MCP server name")
    .argument("<value>", 'JSON object, for example {"command":"uvx","args":["context7-mcp"]}')
    .action(async (name: string, rawValue: string) => {
      const parsed = parseConfigValue(rawValue);
      if (parsed.error) {
        fail(parsed.error);
      }
      const result = await setConfiguredMcpServer({ name, server: parsed.value });
      if (!result.ok) {
        fail(result.error);
      }
      defaultRuntime.log(`Saved MCP server "${name}" to ${result.path}.`);
    });

  mcp
    .command("unset")
    .description("Remove one configured MCP server")
    .argument("<name>", "MCP server name")
    .action(async (name: string) => {
      const result = await unsetConfiguredMcpServer({ name });
      if (!result.ok) {
        fail(result.error);
      }
      if (!result.removed) {
        fail(`No MCP server named "${name}" in ${result.path}.`);
      }
      defaultRuntime.log(`Removed MCP server "${name}" from ${result.path}.`);
    });

  mcp
    .command("tools")
    .description("Connect to configured MCP servers and list their tools")
    .argument("[server]", "MCP server name (defaults to all servers)")
    .option("--json", "Print JSON")
    .action(async (server: string | undefined, opts: { json?: boolean }) => {
      try {
        const catalog = await withMcpRuntime((runtime) => runtime.getCatalog());
        if (server && !catalog.servers[server]) {
          throw new Error(`No connected MCP server named "${server}".`);
        }
        const tools = catalog.tools
          .filter((tool) => !server || tool.serverName === server)
          .map((tool) => ({
            server: tool.serverName,
            tool: tool.toolName,
            description: tool.description ?? tool.title ?? tool.fallbackDescription,
            inputSchema: tool.inputSchema,
          }));
        if (opts.json) {
          printJson(tools);
          return;
        }
        if (tools.length === 0) {
          defaultRuntime.log("No MCP tools found.");
          return;
        }
        for (const tool of tools) {
          defaultRuntime.log(`${tool.server}/${tool.tool} - ${tool.description}`);
        }
      } catch (err) {
        fail(err instanceof Error ? err.message : String(err));
      }
    });

  mcp
    .command("call")
    .description("Call one tool on a configured MCP server")
    .argument("<server>", "MCP server name")
    .argument("<tool>", "Tool name")
    .argument("[args]", "Tool arguments as a JSON object", "{}")
    .option("--json", "Print the raw tool result as JSON")
    .action(async (server: string, tool: string, rawArgs: string, opts: { json?: boolean }) => {
      try {
        const parsed = parseConfigValue(rawArgs);
        if (parsed.error) {
          throw new Error(parsed.error);
        }
        const result = await withMcpRuntime(async (runtime) => {
          const catalog = await runtime.getCatalog();
          if (!catalog.servers[server]) {
            throw new Error(`No connected MCP server named "${server}".`);
          }
          return await runtime.callTool(server, tool, parsed.value);
        });
        if (opts.json) {
          printJson(result);
        } else {
          for (const block of result.content ?? []) {
            if (block.type === "text") {
              defaultRuntime.log(block.text);
            } else {
              printJson(block);
            }
          }
        }
        if (result.isError) {
          defaultRuntime.exit(1);
        }
      } catch (err) {
        fail(err instanceof Error ? err.message : String(err));
      }
    });
}
