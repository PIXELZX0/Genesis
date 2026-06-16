import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TEST_UNDICI_RUNTIME_DEPS_KEY } from "../../infra/net/undici-runtime.js";
import {
  postTrustedWebToolsJson,
  withTrustedWebSearchEndpoint,
} from "./web-search-provider-common.js";

function okResponse(): Response {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ "content-type": "application/json" }),
    text: async () => "{}",
    json: async () => ({}),
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
    Agent: vi.fn(function MockAgent(this: { options: unknown }, options: unknown) {
      this.options = options;
    }),
    EnvHttpProxyAgent: vi.fn(function MockEnvHttpProxyAgent(
      this: { options: unknown },
      options: unknown,
    ) {
      this.options = options;
    }),
    ProxyAgent: vi.fn(function MockProxyAgent(this: { options: unknown }, options: unknown) {
      this.options = options;
    }),
    Socks5ProxyAgent: socks5ProxyAgentCtor,
    fetch: vi.fn(async () => okResponse()),
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

describe("web_search Tor routing", () => {
  beforeEach(() => {
    global.fetch = vi.fn(async () => okResponse());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(globalThis as object, TEST_UNDICI_RUNTIME_DEPS_KEY);
  });

  it("routes .onion URLs through SOCKS5 when Tor is enabled", async () => {
    const socks5ProxyAgentCtor = installMockSocks5ProxyAgent();
    const fetchSpy = vi.fn(async () => okResponse());
    global.fetch = fetchSpy;

    await withTrustedWebSearchEndpoint(
      {
        url: "http://searx.onion/search?q=test",
        timeoutSeconds: 10,
        init: {},
        config: torConfig(true),
      },
      async (response) => response,
    );

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(getRequestDispatcher(fetchSpy)).toBeDefined();
    expect(socks5ProxyAgentCtor).toHaveBeenCalledWith(
      "socks5://127.0.0.1:9050",
      expect.objectContaining({ allowH2: false }),
    );
  });

  it("blocks .onion URLs when Tor is disabled", async () => {
    installMockSocks5ProxyAgent();

    await expect(
      withTrustedWebSearchEndpoint(
        {
          url: "http://searx.onion/search?q=test",
          timeoutSeconds: 10,
          init: {},
          config: torConfig(false),
        },
        async () => okResponse(),
      ),
    ).rejects.toThrow(/Blocked .onion URL|Tor/i);
  });

  it("keeps clearnet URLs direct when Tor is enabled", async () => {
    const socks5ProxyAgentCtor = installMockSocks5ProxyAgent();
    const fetchSpy = vi.fn(async () => okResponse());
    global.fetch = fetchSpy;

    await withTrustedWebSearchEndpoint(
      {
        url: "https://api.search.brave.com/res/v1/web/search?q=test",
        timeoutSeconds: 10,
        init: {},
        config: torConfig(true),
      },
      async (response) => response,
    );

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(getRequestDispatcher(fetchSpy)).toBeDefined();
    expect(socks5ProxyAgentCtor).not.toHaveBeenCalled();
  });

  it("routes POST .onion JSON requests through SOCKS5 when Tor is enabled", async () => {
    const socks5ProxyAgentCtor = installMockSocks5ProxyAgent();
    const fetchSpy = vi.fn(async () => okResponse());
    global.fetch = fetchSpy;

    await postTrustedWebToolsJson(
      {
        url: "http://tavily.onion/search",
        timeoutSeconds: 10,
        apiKey: "test-key",
        body: { query: "test" },
        errorLabel: "Test",
        config: torConfig(true),
      },
      async (response) => response,
    );

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(getRequestDispatcher(fetchSpy)).toBeDefined();
    expect(socks5ProxyAgentCtor).toHaveBeenCalledWith(
      "socks5://127.0.0.1:9050",
      expect.objectContaining({ allowH2: false }),
    );
  });
});
