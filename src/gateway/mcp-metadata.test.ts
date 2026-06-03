import { beforeEach, describe, expect, it, vi } from "vitest";
import type { McpServerConfig } from "../config/types.mcp.js";
import {
  completeMcpOAuthFlow,
  ensureFreshMcpOAuthToken,
  fetchMcpServerMetadata,
  refreshMcpOAuthToken,
  revokeMcpOAuthToken,
  setMcpServerConfigCache,
  startMcpOAuthFlow,
  type McpOAuthRuntime,
} from "./mcp-metadata.js";

// Stub signature compatible with the module's internal `FetchLike`.
type FetchStub = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function urlOf(input: RequestInfo | URL): string {
  return typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
}

function bodyText(init?: RequestInit): string {
  const body = init?.body;
  return typeof body === "string" ? body : "";
}

function methodOf(init?: RequestInit): string {
  const body = init?.body;
  if (typeof body !== "string") {
    return "";
  }
  try {
    return (JSON.parse(body) as { method?: string }).method ?? "";
  } catch {
    return "";
  }
}

// In-memory token/state store shared with the mocked module below.
const stores = vi.hoisted(() => ({
  tokens: new Map<string, Record<string, unknown>>(),
  states: new Map<string, Record<string, unknown>>(),
  seq: 0,
}));

vi.mock("./mcp-oauth-store.js", async (importActual) => {
  const actual = await importActual<typeof import("./mcp-oauth-store.js")>();
  return {
    ...actual, // keep buildMcpOAuthAuthorizeUrl + generatePkcePair real
    createMcpOAuthState: (rec: Record<string, unknown>) => {
      const id = `state-${++stores.seq}`;
      stores.states.set(id, { ...rec, createdAtMs: Date.now() });
      return id;
    },
    consumeMcpOAuthState: (s: string) => {
      const r = stores.states.get(s) ?? null;
      stores.states.delete(s);
      return r;
    },
    getMcpOAuthToken: (n: string) => stores.tokens.get(n) ?? null,
    setMcpOAuthToken: (n: string, t: Record<string, unknown>) => {
      stores.tokens.set(n, t);
    },
    listMcpOAuthTokens: () => Object.fromEntries(stores.tokens),
  };
});

const runtime: McpOAuthRuntime = {
  gatewayWebUrl: "http://127.0.0.1:18789",
  resolveClientId: () => "client-123",
};

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  stores.tokens.clear();
  stores.states.clear();
  stores.seq = 0;
  setMcpServerConfigCache(null);
});

describe("startMcpOAuthFlow", () => {
  const server: McpServerConfig = {
    auth: { authorizeUrl: "https://prov.test/authorize", tokenUrl: "https://prov.test/token" },
  } as McpServerConfig;

  it("includes PKCE S256 and the same-origin callback redirect", async () => {
    const res = await startMcpOAuthFlow(runtime, "srv", server, ["read"]);
    const url = new URL(res.authorizeUrl);
    expect(url.searchParams.get("code_challenge")).toBeTruthy();
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("client_id")).toBe("client-123");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "http://127.0.0.1:18789/mcp-oauth-callback.html",
    );
    // The verifier is persisted on the state for later exchange.
    expect(stores.states.get(res.state)?.codeVerifier).toBeTruthy();
  });

  it("omits PKCE when auth.usePkce is false", async () => {
    const noPkce = {
      auth: { ...(server.auth as Record<string, unknown>), usePkce: false },
    } as McpServerConfig;
    const res = await startMcpOAuthFlow(runtime, "srv", noPkce);
    expect(new URL(res.authorizeUrl).searchParams.get("code_challenge")).toBeNull();
  });

  it("throws when authorizeUrl/tokenUrl are missing", async () => {
    await expect(startMcpOAuthFlow(runtime, "srv", {} as McpServerConfig)).rejects.toThrow(
      /authorizeUrl/,
    );
  });
});

describe("completeMcpOAuthFlow", () => {
  const server: McpServerConfig = {
    auth: {
      authorizeUrl: "https://prov.test/authorize",
      tokenUrl: "https://prov.test/token",
      clientSecret: "shh",
      revokeUrl: "https://prov.test/revoke",
    },
  } as McpServerConfig;

  it("exchanges the code, sends the PKCE verifier, and persists the token", async () => {
    setMcpServerConfigCache({ srv: server });
    const start = await startMcpOAuthFlow(runtime, "srv", server, ["read"]);
    const fetchImpl = vi.fn<FetchStub>(async () =>
      json({ access_token: "AT", refresh_token: "RT", expires_in: 3600, scope: "read write" }),
    );
    const done = await completeMcpOAuthFlow(
      runtime,
      { name: "srv", state: start.state, code: "CODE" },
      { fetchImpl },
    );
    expect(done.ok).toBe(true);
    const body = bodyText(fetchImpl.mock.calls[0]?.[1]);
    expect(body).toContain("grant_type=authorization_code");
    expect(body).toContain("code_verifier=");
    const token = stores.tokens.get("srv");
    expect(token?.accessToken).toBe("AT");
    expect(token?.refreshToken).toBe("RT");
    expect(token?.tokenUrl).toBe("https://prov.test/token");
    expect(token?.revokeUrl).toBe("https://prov.test/revoke");
  });

  it("rejects a state/name mismatch", async () => {
    setMcpServerConfigCache({ srv: server });
    const done = await completeMcpOAuthFlow(
      runtime,
      { name: "srv", state: "bogus", code: "CODE" },
      { fetchImpl: vi.fn<FetchStub>(async () => json({})) },
    );
    expect(done.ok).toBe(false);
    expect(done.message).toMatch(/expired or invalid/);
  });
});

describe("refresh / revoke", () => {
  it("refreshes an access token and preserves the refresh token", async () => {
    stores.tokens.set("srv", {
      accessToken: "old",
      refreshToken: "RT",
      tokenUrl: "https://prov.test/token",
      expiresAtMs: Date.now() + 1000,
    });
    const fetchImpl = vi.fn<FetchStub>(async () => json({ access_token: "NEW", expires_in: 3600 }));
    const res = await refreshMcpOAuthToken("srv", {} as McpServerConfig, {
      clientId: "client-123",
      fetchImpl,
    });
    expect(res.ok).toBe(true);
    expect(stores.tokens.get("srv")?.accessToken).toBe("NEW");
    expect(stores.tokens.get("srv")?.refreshToken).toBe("RT");
  });

  it("returns ok:false when there is no refresh token", async () => {
    stores.tokens.set("srv", { accessToken: "x" });
    const res = await refreshMcpOAuthToken("srv", {} as McpServerConfig, {
      clientId: "c",
      fetchImpl: vi.fn<FetchStub>(async () => json({})),
    });
    expect(res.ok).toBe(false);
  });

  it("only refreshes opportunistically when near expiry", async () => {
    stores.tokens.set("srv", {
      accessToken: "fresh",
      refreshToken: "RT",
      tokenUrl: "https://prov.test/token",
      expiresAtMs: Date.now() + 3_600_000,
    });
    const fetchImpl = vi.fn<FetchStub>(async () => json({ access_token: "NEW" }));
    await ensureFreshMcpOAuthToken("srv", {} as McpServerConfig, { clientId: "c", fetchImpl });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("revokes best-effort using the stored revokeUrl", async () => {
    stores.tokens.set("srv", {
      accessToken: "AT",
      refreshToken: "RT",
      revokeUrl: "https://prov.test/revoke",
    });
    const fetchImpl = vi.fn<FetchStub>(async () => new Response("", { status: 200 }));
    const res = await revokeMcpOAuthToken("srv", {} as McpServerConfig, {
      clientId: "c",
      fetchImpl,
    });
    expect(res.revoked).toBe(true);
    expect(urlOf(fetchImpl.mock.calls[0]?.[0] ?? "")).toBe("https://prov.test/revoke");
    expect(bodyText(fetchImpl.mock.calls[0]?.[1])).toContain("token=RT");
  });
});

describe("fetchMcpServerMetadata", () => {
  function mcpServer(initResult: unknown): FetchStub {
    return async (_input, init) => {
      const method = methodOf(init);
      if (method === "ping") {
        return json({ jsonrpc: "2.0", id: 0, result: {} });
      }
      if (method === "initialize") {
        return json({ jsonrpc: "2.0", id: 1, result: initResult });
      }
      return json({});
    };
  }

  it("discovers transport + OAuth via standard well-known metadata", async () => {
    const base = mcpServer({ serverInfo: { name: "Test", version: "1" }, capabilities: {} });
    const fetchImpl = vi.fn<FetchStub>(async (input, init) => {
      const url = urlOf(input);
      if (url.endsWith("/.well-known/oauth-authorization-server")) {
        return json({
          authorization_endpoint: "https://as.test/auth",
          token_endpoint: "https://as.test/token",
          scopes_supported: ["read"],
        });
      }
      if (url.includes("/.well-known/")) {
        return new Response("", { status: 404 });
      }
      return base(input, init);
    });
    const meta = await fetchMcpServerMetadata("https://srv.test/mcp", { fetchImpl });
    expect(meta.transport).toBe("streamable-http");
    expect(meta.oauth).toBe(true);
    expect(meta.oauthAuthorizeUrl).toBe("https://as.test/auth");
    expect(meta.oauthScopes).toEqual(["read"]);
  });

  it("falls back to RFC 9728 protected-resource discovery", async () => {
    const base = mcpServer({ serverInfo: { name: "Notion" }, capabilities: {} });
    const fetchImpl = vi.fn<FetchStub>(async (input, init) => {
      const url = urlOf(input);
      if (url.endsWith("/.well-known/oauth-protected-resource")) {
        return json({ authorization_servers: ["https://auth.notion.test"] });
      }
      if (url === "https://auth.notion.test/.well-known/oauth-authorization-server") {
        return json({
          authorization_endpoint: "https://auth.notion.test/auth",
          token_endpoint: "https://auth.notion.test/token",
        });
      }
      if (url.includes("/.well-known/")) {
        return new Response("", { status: 404 });
      }
      return base(input, init);
    });
    const meta = await fetchMcpServerMetadata("https://notion.test/mcp", { fetchImpl });
    expect(meta.oauth).toBe(true);
    expect(meta.oauthAuthorizeUrl).toBe("https://auth.notion.test/auth");
  });

  it("rejects a malformed URL", async () => {
    await expect(
      fetchMcpServerMetadata("not-a-url", { fetchImpl: vi.fn<FetchStub>(async () => json({})) }),
    ).rejects.toThrow();
  });

  it("blocks a private-IP target via the default SSRF guard (no stub)", async () => {
    await expect(fetchMcpServerMetadata("http://127.0.0.1:9/mcp")).rejects.toThrow();
  });
});
