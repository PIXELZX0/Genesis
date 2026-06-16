import { afterEach, describe, expect, it, vi } from "vitest";
import { TEST_UNDICI_RUNTIME_DEPS_KEY } from "../../infra/net/undici-runtime.js";
import { resolveCitationRedirectUrl } from "./web-search-citation-redirect.js";

function redirectResponse(location: string): Response {
  return {
    ok: false,
    status: 302,
    headers: new Headers({ location }),
    body: { cancel: vi.fn() },
  } as unknown as Response;
}

function installMockSocks5ProxyAgent() {
  const socks5ProxyAgentCtor = vi.fn(function MockSocks5ProxyAgent(
    this: { proxyUrl: unknown; options: unknown },
    proxyUrl: unknown,
    options: unknown,
  ) {
    this.proxyUrl = proxyUrl;
    this.options = options;
  });
  (globalThis as Record<string, unknown>)[TEST_UNDICI_RUNTIME_DEPS_KEY] = {
    Agent: vi.fn(),
    EnvHttpProxyAgent: vi.fn(),
    ProxyAgent: vi.fn(),
    Socks5ProxyAgent: socks5ProxyAgentCtor,
    fetch: vi.fn(),
  };
  return socks5ProxyAgentCtor;
}

function getRequestDispatcher(fetchSpy: ReturnType<typeof vi.fn>): unknown {
  const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
  return (init as RequestInit & { dispatcher?: unknown }).dispatcher;
}

function torConfig(enabled: boolean) {
  return {
    tools: {
      web: {
        tor: {
          enabled,
          mode: "external" as const,
          socksHost: "127.0.0.1",
          socksPort: 9050,
        },
      },
    },
  };
}

describe("resolveCitationRedirectUrl", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(globalThis as object, TEST_UNDICI_RUNTIME_DEPS_KEY);
  });

  it("resolves a clearnet redirect without Tor", async () => {
    const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url === "https://example.com/final") {
        return { ok: true, status: 200 } as Response;
      }
      return redirectResponse("https://example.com/final");
    });
    global.fetch = fetchSpy;

    const result = await resolveCitationRedirectUrl("https://example.com/start");
    expect(result).toBe("https://example.com/final");
  });

  it("routes .onion citation redirects through Tor when enabled", async () => {
    const socks5ProxyAgentCtor = installMockSocks5ProxyAgent();
    const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url === "http://abc123.onion/final") {
        return { ok: true, status: 200 } as Response;
      }
      return redirectResponse("http://abc123.onion/final");
    });
    global.fetch = fetchSpy;

    const result = await resolveCitationRedirectUrl("http://abc123.onion/start", torConfig(true));
    expect(result).toBe("http://abc123.onion/final");
    expect(getRequestDispatcher(fetchSpy)).toBeDefined();
    expect(socks5ProxyAgentCtor).toHaveBeenCalledWith(
      "socks5://127.0.0.1:9050",
      expect.objectContaining({ allowH2: false }),
    );
  });

  it("returns original .onion URL when Tor is disabled", async () => {
    installMockSocks5ProxyAgent();

    const result = await resolveCitationRedirectUrl("http://abc123.onion/start", torConfig(false));
    expect(result).toBe("http://abc123.onion/start");
  });
});
