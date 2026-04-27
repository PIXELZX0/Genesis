import { afterEach, describe, expect, it, vi } from "vitest";
import "./server-context.chrome-test-harness.js";
import {
  PROFILE_ATTACH_RETRY_TIMEOUT_MS,
  PROFILE_HTTP_REACHABILITY_TIMEOUT_MS,
} from "./cdp-timeouts.js";
import * as chromeModule from "./chrome.js";
import { BrowserProfileUnavailableError } from "./errors.js";
import { createBrowserRouteContext } from "./server-context.js";
import { makeBrowserServerState, mockLaunchedChrome } from "./server-context.test-harness.js";

function setupEnsureBrowserAvailableHarness() {
  vi.useFakeTimers();

  const launchGenesisChrome = vi.mocked(chromeModule.launchGenesisChrome);
  const stopGenesisChrome = vi.mocked(chromeModule.stopGenesisChrome);
  const isChromeReachable = vi.mocked(chromeModule.isChromeReachable);
  const isChromeCdpReady = vi.mocked(chromeModule.isChromeCdpReady);
  isChromeReachable.mockResolvedValue(false);

  const state = makeBrowserServerState();
  const ctx = createBrowserRouteContext({ getState: () => state });
  const profile = ctx.forProfile("genesis");

  return { launchGenesisChrome, stopGenesisChrome, isChromeCdpReady, profile, state };
}

function createAttachOnlyLoopbackProfile(cdpUrl: string) {
  const state = makeBrowserServerState({
    profile: {
      name: "manual-cdp",
      cdpUrl,
      cdpHost: "127.0.0.1",
      cdpIsLoopback: true,
      cdpPort: 9222,
      color: "#00AA00",
      driver: "genesis",
      headless: false,
      attachOnly: true,
    },
    resolvedOverrides: {
      defaultProfile: "manual-cdp",
      ssrfPolicy: {},
    },
  });
  const ctx = createBrowserRouteContext({ getState: () => state });
  return { profile: ctx.forProfile("manual-cdp"), state };
}

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("browser server-context ensureBrowserAvailable", () => {
  it("waits for CDP readiness after launching to avoid follow-up PortInUseError races (#21149)", async () => {
    const { launchGenesisChrome, stopGenesisChrome, isChromeCdpReady, profile } =
      setupEnsureBrowserAvailableHarness();
    isChromeCdpReady.mockResolvedValueOnce(false).mockResolvedValue(true);
    mockLaunchedChrome(launchGenesisChrome, 123);

    const promise = profile.ensureBrowserAvailable();
    await vi.advanceTimersByTimeAsync(100);
    await expect(promise).resolves.toBeUndefined();

    expect(launchGenesisChrome).toHaveBeenCalledTimes(1);
    expect(isChromeCdpReady).toHaveBeenCalled();
    expect(stopGenesisChrome).not.toHaveBeenCalled();
  });

  it("stops launched chrome when CDP readiness never arrives", async () => {
    const { launchGenesisChrome, stopGenesisChrome, isChromeCdpReady, profile } =
      setupEnsureBrowserAvailableHarness();
    isChromeCdpReady.mockResolvedValue(false);
    mockLaunchedChrome(launchGenesisChrome, 321);

    const promise = profile.ensureBrowserAvailable();
    const rejected = expect(promise).rejects.toThrow("not reachable after start");
    const diagnosticRejected = expect(promise).rejects.toThrow(
      "CDP diagnostic: websocket_health_command_timeout; mock CDP diagnostic.",
    );
    await vi.advanceTimersByTimeAsync(8100);
    await rejected;
    await diagnosticRejected;

    expect(launchGenesisChrome).toHaveBeenCalledTimes(1);
    expect(stopGenesisChrome).toHaveBeenCalledTimes(1);
  });

  it("deduplicates concurrent lazy-start calls to prevent PortInUseError", async () => {
    const { launchGenesisChrome, stopGenesisChrome, isChromeCdpReady, profile } =
      setupEnsureBrowserAvailableHarness();
    isChromeCdpReady.mockResolvedValue(true);
    mockLaunchedChrome(launchGenesisChrome, 456);

    const first = profile.ensureBrowserAvailable();
    const second = profile.ensureBrowserAvailable();
    await vi.advanceTimersByTimeAsync(100);
    await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined]);

    expect(launchGenesisChrome).toHaveBeenCalledTimes(1);
    expect(stopGenesisChrome).not.toHaveBeenCalled();
  });

  it("clears the concurrent lazy-start guard after launch failure", async () => {
    const { launchGenesisChrome, stopGenesisChrome, isChromeCdpReady, profile } =
      setupEnsureBrowserAvailableHarness();
    isChromeCdpReady.mockResolvedValue(true);
    launchGenesisChrome.mockRejectedValueOnce(
      new Error("PortInUseError: listen EADDRINUSE 127.0.0.1:18800"),
    );

    const first = profile.ensureBrowserAvailable();
    const second = profile.ensureBrowserAvailable();
    await expect(Promise.all([first, second])).rejects.toThrow("PortInUseError");

    mockLaunchedChrome(launchGenesisChrome, 789);
    const retry = profile.ensureBrowserAvailable();
    await vi.advanceTimersByTimeAsync(100);
    await expect(retry).resolves.toBeUndefined();

    expect(launchGenesisChrome).toHaveBeenCalledTimes(2);
    expect(stopGenesisChrome).not.toHaveBeenCalled();
  });

  it("reuses a pre-existing loopback browser after an initial short probe miss", async () => {
    const { launchGenesisChrome, stopGenesisChrome, isChromeCdpReady, profile, state } =
      setupEnsureBrowserAvailableHarness();
    const isChromeReachable = vi.mocked(chromeModule.isChromeReachable);
    state.resolved.ssrfPolicy = {};

    isChromeReachable.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    isChromeCdpReady.mockResolvedValueOnce(true);

    await expect(profile.ensureBrowserAvailable()).resolves.toBeUndefined();

    expect(isChromeReachable).toHaveBeenNthCalledWith(
      1,
      "http://127.0.0.1:18800",
      PROFILE_HTTP_REACHABILITY_TIMEOUT_MS,
      undefined,
    );
    expect(isChromeReachable).toHaveBeenNthCalledWith(
      2,
      "http://127.0.0.1:18800",
      PROFILE_ATTACH_RETRY_TIMEOUT_MS,
      undefined,
    );
    expect(launchGenesisChrome).not.toHaveBeenCalled();
    expect(stopGenesisChrome).not.toHaveBeenCalled();
  });

  it("retries remote CDP websocket reachability once before failing", async () => {
    const { launchGenesisChrome, stopGenesisChrome, isChromeCdpReady } =
      setupEnsureBrowserAvailableHarness();
    const isChromeReachable = vi.mocked(chromeModule.isChromeReachable);

    const state = makeBrowserServerState();
    state.resolved.profiles.genesis = {
      cdpUrl: "ws://browserless:3001",
      color: "#00AA00",
    };
    const ctx = createBrowserRouteContext({ getState: () => state });
    const profile = ctx.forProfile("genesis");
    const expectedRemoteHttpTimeoutMs = state.resolved.remoteCdpTimeoutMs;
    const expectedRemoteWsTimeoutMs = state.resolved.remoteCdpHandshakeTimeoutMs;

    isChromeReachable.mockResolvedValueOnce(true);
    isChromeCdpReady.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

    await expect(profile.ensureBrowserAvailable()).resolves.toBeUndefined();

    expect(isChromeReachable).toHaveBeenCalledTimes(1);
    expect(isChromeCdpReady).toHaveBeenCalledTimes(2);
    expect(isChromeCdpReady).toHaveBeenNthCalledWith(
      1,
      "ws://browserless:3001",
      expectedRemoteHttpTimeoutMs,
      expectedRemoteWsTimeoutMs,
      {
        allowPrivateNetwork: true,
      },
    );
    expect(isChromeCdpReady).toHaveBeenNthCalledWith(
      2,
      "ws://browserless:3001",
      expectedRemoteHttpTimeoutMs,
      expectedRemoteWsTimeoutMs,
      {
        allowPrivateNetwork: true,
      },
    );
    expect(launchGenesisChrome).not.toHaveBeenCalled();
    expect(stopGenesisChrome).not.toHaveBeenCalled();
  });

  it("treats attachOnly loopback CDP as local control with remote-class probe timeouts", async () => {
    const { launchGenesisChrome, stopGenesisChrome } = setupEnsureBrowserAvailableHarness();
    const isChromeReachable = vi.mocked(chromeModule.isChromeReachable);
    const isChromeCdpReady = vi.mocked(chromeModule.isChromeCdpReady);

    const { profile, state } = createAttachOnlyLoopbackProfile("http://127.0.0.1:9222");

    isChromeReachable.mockResolvedValueOnce(true);
    isChromeCdpReady.mockResolvedValueOnce(true);

    await expect(profile.ensureBrowserAvailable()).resolves.toBeUndefined();

    expect(isChromeReachable).toHaveBeenCalledWith(
      "http://127.0.0.1:9222",
      state.resolved.remoteCdpTimeoutMs,
      undefined,
    );
    expect(isChromeCdpReady).toHaveBeenCalledWith(
      "http://127.0.0.1:9222",
      state.resolved.remoteCdpTimeoutMs,
      state.resolved.remoteCdpHandshakeTimeoutMs,
      undefined,
    );
    expect(launchGenesisChrome).not.toHaveBeenCalled();
    expect(stopGenesisChrome).not.toHaveBeenCalled();
  });

  it("resolves for attachOnly loopback profile with a bare ws:// cdpUrl when CDP is reachable (#68027)", async () => {
    // Regression for #68027: a bare `ws://host:port` cdpUrl on a loopback
    // attachOnly profile must not surface as
    //   `Browser attachOnly is enabled and profile "<name>" is not running.`
    // when the underlying CDP endpoint is actually healthy. The low-level
    // fix lives in chrome.ts/cdp.ts (see chrome.test.ts #68027 tests); this
    // higher-level test locks the user-facing symptom at
    // ensureBrowserAvailable() so future refactors of the availability flow
    // cannot silently reintroduce the bug by munging/short-circuiting bare
    // ws:// URLs before they reach the helpers.
    const { launchGenesisChrome, stopGenesisChrome } = setupEnsureBrowserAvailableHarness();
    const isChromeReachable = vi.mocked(chromeModule.isChromeReachable);
    const isChromeCdpReady = vi.mocked(chromeModule.isChromeCdpReady);

    const { profile, state } = createAttachOnlyLoopbackProfile("ws://127.0.0.1:9222");

    isChromeReachable.mockResolvedValueOnce(true);
    isChromeCdpReady.mockResolvedValueOnce(true);

    await expect(profile.ensureBrowserAvailable()).resolves.toBeUndefined();

    // The bare ws:// URL must pass through unchanged — the helpers own the
    // discovery-first-then-fallback strategy for bare ws roots.
    expect(isChromeReachable).toHaveBeenCalledWith(
      "ws://127.0.0.1:9222",
      state.resolved.remoteCdpTimeoutMs,
      undefined,
    );
    expect(isChromeCdpReady).toHaveBeenCalledWith(
      "ws://127.0.0.1:9222",
      state.resolved.remoteCdpTimeoutMs,
      state.resolved.remoteCdpHandshakeTimeoutMs,
      undefined,
    );
    expect(launchGenesisChrome).not.toHaveBeenCalled();
    expect(stopGenesisChrome).not.toHaveBeenCalled();
  });

  it("redacts credentials in remote CDP availability errors", async () => {
    const { launchGenesisChrome, stopGenesisChrome } = setupEnsureBrowserAvailableHarness();
    const isChromeReachable = vi.mocked(chromeModule.isChromeReachable);

    const state = makeBrowserServerState({
      profile: {
        name: "remote",
        cdpUrl: "https://user:pass@browserless.example.com?token=supersecret123",
        cdpHost: "browserless.example.com",
        cdpIsLoopback: false,
        cdpPort: 443,
        color: "#00AA00",
        driver: "genesis",
        headless: false,
        attachOnly: false,
      },
      resolvedOverrides: {
        defaultProfile: "remote",
        ssrfPolicy: {},
      },
    });
    const ctx = createBrowserRouteContext({ getState: () => state });
    const profile = ctx.forProfile("remote");

    isChromeReachable.mockResolvedValue(false);

    const promise = profile.ensureBrowserAvailable();
    await expect(promise).rejects.toThrow(BrowserProfileUnavailableError);
    await expect(promise).rejects.toThrow(
      'Remote CDP for profile "remote" is not reachable at https://browserless.example.com/?token=***.',
    );

    expect(launchGenesisChrome).not.toHaveBeenCalled();
    expect(stopGenesisChrome).not.toHaveBeenCalled();
  });
});
