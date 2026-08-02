import { describe, expect, test, vi } from "vitest";
import type { SessionTranscriptUpdate } from "../sessions/transcript-events.js";
import { createTranscriptUpdateBroadcastHandler } from "./server-session-events.js";

function createHandler(params?: {
  globalSubscribers?: ReadonlySet<string>;
  globalMessageSubscribers?: ReadonlySet<string>;
  sessionSubscribers?: ReadonlyMap<string, ReadonlySet<string>>;
}) {
  const globalSubscribers = params?.globalSubscribers ?? new Set<string>();
  const globalMessageSubscribers = params?.globalMessageSubscribers ?? globalSubscribers;
  const sessionSubscribers = params?.sessionSubscribers ?? new Map<string, ReadonlySet<string>>();
  const broadcastToConnIds = vi.fn();
  const handler = createTranscriptUpdateBroadcastHandler({
    broadcastToConnIds,
    sessionEventSubscribers: {
      getAll: () => globalSubscribers,
      getMessageSubscribers: () => globalMessageSubscribers,
    },
    sessionMessageSubscribers: {
      get: (sessionKey) => sessionSubscribers.get(sessionKey) ?? new Set<string>(),
      hasAny: () => sessionSubscribers.size > 0,
    },
  });
  return { broadcastToConnIds, handler };
}

describe("createTranscriptUpdateBroadcastHandler fast exits", () => {
  test("does not resolve a session for file-only updates", () => {
    const { broadcastToConnIds, handler } = createHandler();
    const update = {
      sessionFile: "/tmp/rewrite.jsonl",
      get sessionKey(): string {
        throw new Error("sessionKey should not be read");
      },
    } satisfies SessionTranscriptUpdate;

    expect(() => handler(update)).not.toThrow();
    expect(broadcastToConnIds).not.toHaveBeenCalled();
  });

  test("does not inspect transcript state when no client subscribes", () => {
    const { broadcastToConnIds, handler } = createHandler();
    const update = {
      get sessionFile(): string {
        throw new Error("sessionFile should not be read");
      },
      message: { role: "assistant" },
    } satisfies SessionTranscriptUpdate;

    expect(() => handler(update)).not.toThrow();
    expect(broadcastToConnIds).not.toHaveBeenCalled();
  });

  test("does not inspect transcript state for subscribers to another session", () => {
    const { broadcastToConnIds, handler } = createHandler({
      sessionSubscribers: new Map([["agent:main:other", new Set(["connection-1"])]]),
    });
    const update = {
      get sessionFile(): string {
        throw new Error("sessionFile should not be read");
      },
      sessionKey: "agent:main:target",
      message: { role: "assistant" },
    } satisfies SessionTranscriptUpdate;

    expect(() => handler(update)).not.toThrow();
    expect(broadcastToConnIds).not.toHaveBeenCalled();
  });

  test("sends only a row update to list-only global subscribers", () => {
    const { broadcastToConnIds, handler } = createHandler({
      globalSubscribers: new Set(["list-only-connection"]),
      globalMessageSubscribers: new Set(),
    });
    const update = {
      get sessionFile(): string {
        throw new Error("sessionFile should not be read");
      },
      sessionKey: "agent:main:target",
      message: { role: "assistant" },
    } satisfies SessionTranscriptUpdate;

    expect(() => handler(update)).not.toThrow();
    expect(broadcastToConnIds).toHaveBeenCalledTimes(1);
    expect(broadcastToConnIds).toHaveBeenCalledWith(
      "sessions.changed",
      expect.objectContaining({ sessionKey: "agent:main:target", phase: "message" }),
      new Set(["list-only-connection"]),
      { dropIfSlow: true },
    );
  });
});
