import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ADMIN_SCOPE,
  READ_SCOPE,
  resolveRequiredOperatorScopeForMethod,
} from "../method-scopes.js";
import type { ErrorShape } from "../protocol/index.js";
import { mcpHandlers } from "./mcp.js";

const mcpServers = vi.hoisted(() => new Map<string, Record<string, unknown>>());

vi.mock("../../config/mcp-config.js", () => ({
  listConfiguredMcpServers: vi.fn(async () => ({
    ok: true,
    path: "/tmp/genesis.json",
    config: {},
    mcpServers: Object.fromEntries(mcpServers),
  })),
  setConfiguredMcpServer: vi.fn(async ({ name, server }) => {
    mcpServers.set(name, { ...(server as Record<string, unknown>) });
    return {
      ok: true,
      path: "/tmp/genesis.json",
      config: {},
      mcpServers: Object.fromEntries(mcpServers),
    };
  }),
  unsetConfiguredMcpServer: vi.fn(async ({ name }) => {
    const removed = mcpServers.delete(name);
    return {
      ok: true,
      path: "/tmp/genesis.json",
      config: {},
      mcpServers: Object.fromEntries(mcpServers),
      removed,
    };
  }),
}));

type Captured = { ok: boolean; payload?: unknown; error?: ErrorShape };

function callHandler(method: string, params: Record<string, unknown>): Promise<Captured> {
  return new Promise((resolve) => {
    const respond = (ok: boolean, payload?: unknown, error?: ErrorShape) =>
      resolve({ ok, payload, error });
    void mcpHandlers[method]({ params, respond } as never);
  });
}

describe("mcp gateway handlers", () => {
  afterEach(() => {
    mcpServers.clear();
    vi.clearAllMocks();
  });

  it("set then list returns the configured server", async () => {
    const set = await callHandler("mcp.servers.set", {
      name: "context7",
      server: { url: "https://mcp.context7.com/mcp" },
    });
    expect(set.ok).toBe(true);
    expect((set.payload as { servers: Record<string, unknown> }).servers.context7).toEqual({
      url: "https://mcp.context7.com/mcp",
    });

    const list = await callHandler("mcp.servers.list", {});
    expect(list.ok).toBe(true);
    expect((list.payload as { servers: Record<string, unknown> }).servers).toHaveProperty(
      "context7",
    );
  });

  it("unset removes the server and reports removed=true", async () => {
    await callHandler("mcp.servers.set", { name: "gone", server: { command: "x" } });
    const unset = await callHandler("mcp.servers.unset", { name: "gone" });
    expect(unset.ok).toBe(true);
    expect((unset.payload as { removed?: boolean }).removed).toBe(true);
    expect((unset.payload as { servers: Record<string, unknown> }).servers).not.toHaveProperty(
      "gone",
    );
  });

  it("rejects set with a missing name", async () => {
    const res = await callHandler("mcp.servers.set", { server: { url: "x" } });
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe("INVALID_REQUEST");
  });

  it("rejects set with a non-object server", async () => {
    const res = await callHandler("mcp.servers.set", { name: "bad", server: "nope" });
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe("INVALID_REQUEST");
  });

  it("classifies list as read scope and writes as admin scope", () => {
    expect(resolveRequiredOperatorScopeForMethod("mcp.servers.list")).toBe(READ_SCOPE);
    expect(resolveRequiredOperatorScopeForMethod("mcp.servers.set")).toBe(ADMIN_SCOPE);
    expect(resolveRequiredOperatorScopeForMethod("mcp.servers.unset")).toBe(ADMIN_SCOPE);
  });
});
