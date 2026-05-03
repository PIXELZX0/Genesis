import { describe, expect, it } from "vitest";
import type { ResolvedBrowserTorConfig } from "./config.js";
import { buildTorChromeProxyArgs } from "./tor.js";

function torConfig(routeMode: ResolvedBrowserTorConfig["routeMode"]): ResolvedBrowserTorConfig {
  return {
    enabled: true,
    mode: "managed",
    routeMode,
    socksHost: "127.0.0.1",
    socksPort: 18900,
    extraArgs: [],
  };
}

function decodePacArg(arg: string): string {
  const prefix = "--proxy-pac-url=data:application/x-ns-proxy-autoconfig;base64,";
  expect(arg.startsWith(prefix)).toBe(true);
  return Buffer.from(arg.slice(prefix.length), "base64").toString("utf8");
}

describe("browser Tor launch args", () => {
  it("routes only onion hostnames through Tor by default", () => {
    const args = buildTorChromeProxyArgs(torConfig("onion-only"));
    const pacArg = args.find((arg) => arg.startsWith("--proxy-pac-url="));

    expect(args).not.toContain("--proxy-server=socks5://127.0.0.1:18900");
    expect(args).toContain("--host-resolver-rules=MAP *.onion ~NOTFOUND, EXCLUDE 127.0.0.1");
    expect(args).toContain("--dns-prefetch-disable");
    expect(decodePacArg(pacArg ?? "")).toContain('return "SOCKS5 127.0.0.1:18900";');
    expect(decodePacArg(pacArg ?? "")).toContain('return "DIRECT";');
  });

  it("keeps whole-browser Tor routing available for explicit all mode", () => {
    expect(buildTorChromeProxyArgs(torConfig("all"))).toEqual([
      "--proxy-server=socks5://127.0.0.1:18900",
      "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1",
      "--dns-prefetch-disable",
    ]);
  });
});
