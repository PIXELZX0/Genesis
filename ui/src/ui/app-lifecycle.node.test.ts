// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { handleDisconnected, handleUpdated } from "./app-lifecycle.ts";

function createHost() {
  return {
    basePath: "",
    client: { request: vi.fn(async () => ({})), stop: vi.fn() },
    connectGeneration: 0,
    connected: true,
    sessionKey: "agent:main:main",
    sessionsError: null,
    tab: "chat",
    assistantName: "Genesis",
    assistantAvatar: null,
    assistantAgentId: null,
    localMediaPreviewRoots: [],
    chatHasAutoScrolled: false,
    chatManualRefreshInFlight: false,
    chatLoading: false,
    chatMessages: [],
    chatToolMessages: [],
    chatStream: null,
    logsAutoFollow: false,
    logsAtBottom: true,
    logsEntries: [],
    popStateHandler: vi.fn(),
    topbarObserver: { disconnect: vi.fn() } as unknown as ResizeObserver,
  };
}

describe("handleDisconnected", () => {
  it("stops and clears gateway client on teardown", () => {
    vi.stubGlobal("window", {
      removeEventListener: vi.fn(),
    });
    const removeSpy = vi.spyOn(window, "removeEventListener").mockImplementation(() => undefined);
    const host = createHost();
    const disconnectSpy = (
      host.topbarObserver as unknown as { disconnect: ReturnType<typeof vi.fn> }
    ).disconnect;

    handleDisconnected(host as unknown as Parameters<typeof handleDisconnected>[0]);

    expect(removeSpy).toHaveBeenCalledWith("popstate", host.popStateHandler);
    expect(host.connectGeneration).toBe(1);
    expect(host.client).toBeNull();
    expect(host.connected).toBe(false);
    expect(disconnectSpy).toHaveBeenCalledTimes(1);
    expect(host.topbarObserver).toBeNull();
    removeSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  it("unsubscribes the active transcript before stopping the socket", () => {
    vi.stubGlobal("window", {
      removeEventListener: vi.fn(),
    });
    const host = createHost();
    const client = host.client;

    handleDisconnected(host as unknown as Parameters<typeof handleDisconnected>[0]);

    expect(client?.request).toHaveBeenCalledWith("sessions.messages.unsubscribe", {
      key: "agent:main:main",
    });
    expect(client?.request.mock.invocationCallOrder[0]).toBeLessThan(
      client.stop.mock.invocationCallOrder[0],
    );
    vi.unstubAllGlobals();
  });

  it("rotates transcript subscriptions when the active session changes", async () => {
    const host = createHost();
    host.sessionKey = "agent:main:worker";

    handleUpdated(
      host as unknown as Parameters<typeof handleUpdated>[0],
      new Map([["sessionKey", "agent:main:main"]]),
    );
    await Promise.resolve();

    expect(host.client?.request).toHaveBeenNthCalledWith(1, "sessions.messages.unsubscribe", {
      key: "agent:main:main",
    });
    expect(host.client?.request).toHaveBeenNthCalledWith(2, "sessions.messages.subscribe", {
      key: "agent:main:worker",
    });
  });
});
