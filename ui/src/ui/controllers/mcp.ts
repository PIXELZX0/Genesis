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
};

type McpServersResult = {
  path: string;
  servers: McpServersMap;
  removed?: boolean;
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
