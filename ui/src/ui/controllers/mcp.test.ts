import { describe, expect, it, vi } from "vitest";
import { deleteMcpServer, loadMcpServers, type McpState, saveMcpServer } from "./mcp.ts";

type RequestFn = (method: string, params?: unknown) => Promise<unknown>;

function createState(request: RequestFn, overrides: Partial<McpState> = {}): McpState {
  return {
    client: { request } as unknown as McpState["client"],
    connected: true,
    mcpServersLoading: false,
    mcpServers: null,
    mcpServersPath: null,
    mcpServersError: null,
    mcpBusy: false,
    mcpMessage: null,
    mcpDraftName: "",
    mcpDraftConfig: "",
    mcpAuthToken: "",
    mcpLinkUrl: "",
    mcpLinkMetadataLoading: false,
    mcpLinkMetadataError: null,
    mcpLinkMetadata: null,
    mcpOAuthStatus: {},
    mcpOAuthFlow: null,
    mcpOAuthPopup: null,
    mcpTestStatus: {},
    ...overrides,
  };
}

describe("loadMcpServers", () => {
  it("loads servers and config path", async () => {
    const request = vi.fn(async () => ({
      path: "/tmp/genesis.json",
      servers: { a: { url: "x" } },
    }));
    const state = createState(request);
    await loadMcpServers(state);
    expect(request).toHaveBeenCalledWith("mcp.servers.list", {});
    expect(state.mcpServers).toEqual({ a: { url: "x" } });
    expect(state.mcpServersPath).toBe("/tmp/genesis.json");
    expect(state.mcpServersLoading).toBe(false);
  });

  it("captures request errors", async () => {
    const request = vi.fn(async () => {
      throw new Error("boom");
    });
    const state = createState(request);
    await loadMcpServers(state);
    expect(state.mcpServersError).toBe("boom");
    expect(state.mcpServersLoading).toBe(false);
  });
});

describe("saveMcpServer", () => {
  it("requires a non-empty name", async () => {
    const request = vi.fn(async () => ({}));
    const state = createState(request);
    await saveMcpServer(state, "  ", { url: "x" });
    expect(request).not.toHaveBeenCalled();
    expect(state.mcpMessage?.kind).toBe("error");
  });

  it("sets the server and clears the draft on success", async () => {
    const request = vi.fn(async () => ({
      path: "/tmp/genesis.json",
      servers: { a: { url: "x" } },
    }));
    const state = createState(request, { mcpDraftName: "a", mcpDraftConfig: "{}" });
    await saveMcpServer(state, "a", { url: "x" });
    expect(request).toHaveBeenCalledWith("mcp.servers.set", { name: "a", server: { url: "x" } });
    expect(state.mcpMessage?.kind).toBe("success");
    expect(state.mcpDraftName).toBe("");
    expect(state.mcpDraftConfig).toBe("");
  });
});

describe("deleteMcpServer", () => {
  it("reports a successful removal", async () => {
    const request = vi.fn(async () => ({ path: "/tmp/genesis.json", servers: {}, removed: true }));
    const state = createState(request);
    await deleteMcpServer(state, "a");
    expect(request).toHaveBeenCalledWith("mcp.servers.unset", { name: "a" });
    expect(state.mcpMessage?.kind).toBe("success");
  });

  it("reports when nothing was removed", async () => {
    const request = vi.fn(async () => ({
      path: "/tmp/genesis.json",
      servers: {},
      removed: false,
    }));
    const state = createState(request);
    await deleteMcpServer(state, "missing");
    expect(state.mcpMessage?.kind).toBe("error");
  });
});
