import { describe, expect, it, vi } from "vitest";
import { ensureContactsLoaded, ensureMemoryLoaded } from "./app-render.ts";
import type { AppViewState } from "./app-view-state.ts";
import { resolveSelectedAgentId } from "./app-view-state.ts";
import type { GatewayBrowserClient } from "./gateway.ts";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function createState(request: ReturnType<typeof vi.fn>): AppViewState {
  return {
    client: { request } as unknown as GatewayBrowserClient,
    connected: true,
    assistantAgentId: "assistant",
    agentsSelectedId: null,
    agentsList: null,
    memoryEntries: [],
    memoryLoading: false,
    memoryLoadingAgentId: null,
    memoryLoadedAgentId: null,
    memoryLoadRequestId: 0,
    memoryError: null,
    contactsEntries: [],
    contactsLoading: false,
    contactsLoadingAgentId: null,
    contactsLoadedAgentId: null,
    contactsLoadRequestId: 0,
    contactsError: null,
    memoryGraph: { nodes: [], edges: [], generatedAtMs: 0 },
    memoryGraphLoading: false,
    memoryGraphLoadingAgentId: null,
    memoryGraphLoadedAgentId: null,
    memoryGraphLoadRequestId: 0,
    memoryGraphError: null,
    memoryViewMode: "table",
  } as unknown as AppViewState;
}

async function waitForLoadComplete(check: () => boolean): Promise<void> {
  await vi.waitFor(() => {
    expect(check()).toBe(true);
  });
}

describe("Control UI agent-backed memory and contacts loading", () => {
  it("resolves the selected, default, first, then assistant agent in order", () => {
    const state = {
      agentsSelectedId: "selected",
      agentsList: {
        defaultId: "default",
        agents: [{ id: "first" }],
      },
      assistantAgentId: "assistant",
    };
    expect(resolveSelectedAgentId(state)).toBe("selected");
    expect(resolveSelectedAgentId({ ...state, agentsSelectedId: null })).toBe("default");
    expect(
      resolveSelectedAgentId({
        ...state,
        agentsSelectedId: null,
        agentsList: {
          defaultId: null,
          agents: [{ id: "first" }],
        },
      }),
    ).toBe("first");
    expect(
      resolveSelectedAgentId({
        ...state,
        agentsSelectedId: null,
        agentsList: {
          defaultId: null,
          agents: [],
        },
      }),
    ).toBe("assistant");
  });

  it("marks an empty memory table result loaded without retrying on the next render", async () => {
    const request = vi.fn(async () => ({ file: { content: "" } }));
    const state = createState(request);

    ensureMemoryLoaded(state);
    await waitForLoadComplete(() => !state.memoryLoading);
    ensureMemoryLoaded(state);

    expect(request).toHaveBeenCalledTimes(1);
    expect(state.memoryEntries).toEqual([]);
    expect(state.memoryLoadedAgentId).toBe("assistant");
  });

  it("shows a memory error without retrying on the next render", async () => {
    const request = vi.fn(async () => {
      throw new Error("memory unavailable");
    });
    const state = createState(request);

    ensureMemoryLoaded(state);
    await waitForLoadComplete(() => state.memoryError !== null);
    ensureMemoryLoaded(state);

    expect(request).toHaveBeenCalledTimes(1);
    expect(state.memoryError).toContain("memory unavailable");
    expect(state.memoryLoadedAgentId).toBe("assistant");
  });

  it("ignores a memory response for an agent that is no longer selected", async () => {
    const first = deferred<{ file: { content: string } }>();
    const second = deferred<{ file: { content: string } }>();
    const request = vi
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const state = createState(request);
    state.agentsSelectedId = "agent-a";

    ensureMemoryLoaded(state);
    state.agentsSelectedId = "agent-b";
    ensureMemoryLoaded(state);

    first.resolve({ file: { content: "- [Old](old.md)" } });
    await Promise.resolve();
    await Promise.resolve();
    expect(state.memoryEntries).toEqual([]);
    expect(state.memoryLoading).toBe(true);

    second.resolve({ file: { content: "- [Current](current.md)" } });
    await waitForLoadComplete(() => state.memoryLoadedAgentId === "agent-b");
    expect(state.memoryEntries).toEqual([{ name: "Current", file: "current.md", description: "" }]);
  });

  it("loads only the graph while graph mode is active", async () => {
    const request = vi.fn(async () => ({ nodes: [], edges: [], generatedAtMs: 1 }));
    const state = createState(request);
    state.memoryViewMode = "graph";

    ensureMemoryLoaded(state);
    await waitForLoadComplete(() => !state.memoryGraphLoading);

    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith(
      "agents.memory.graph",
      { agentId: "assistant" },
      expect.anything(),
    );
    expect(state.memoryGraphLoadedAgentId).toBe("assistant");
    expect(state.memoryLoadedAgentId).toBeNull();
  });

  it("discards stale contact responses and remembers an empty result", async () => {
    const first = deferred<{ contacts: Array<{ id: string; name: string; messengerIds: [] }> }>();
    const second = deferred<{ contacts: [] }>();
    const request = vi
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const state = createState(request);
    state.agentsSelectedId = "agent-a";

    ensureContactsLoaded(state);
    state.agentsSelectedId = "agent-b";
    ensureContactsLoaded(state);

    first.resolve({ contacts: [{ id: "old", name: "Old", messengerIds: [] }] });
    await Promise.resolve();
    await Promise.resolve();
    expect(state.contactsEntries).toEqual([]);

    second.resolve({ contacts: [] });
    await waitForLoadComplete(() => state.contactsLoadedAgentId === "agent-b");
    ensureContactsLoaded(state);

    expect(request).toHaveBeenCalledTimes(2);
    expect(state.contactsEntries).toEqual([]);
    expect(state.contactsLoadedAgentId).toBe("agent-b");
  });
});
