import { describe, expect, it, vi } from "vitest";
import { createSocks5ProxyAgent, TEST_UNDICI_RUNTIME_DEPS_KEY } from "./undici-runtime.js";

describe("createSocks5ProxyAgent", () => {
  it("rejects non-SOCKS proxy URLs", () => {
    expect(() => createSocks5ProxyAgent("http://127.0.0.1:9050")).toThrow(/must use socks5/i);
  });

  it("accepts socks5, socks5h, and socks URLs", () => {
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

    try {
      for (const url of ["socks5://127.0.0.1:9050", "socks5h://127.0.0.1:9050"]) {
        createSocks5ProxyAgent(url);
      }
      expect(socks5ProxyAgentCtor).toHaveBeenCalledTimes(2);
    } finally {
      Reflect.deleteProperty(globalThis as object, TEST_UNDICI_RUNTIME_DEPS_KEY);
    }
  });
});
