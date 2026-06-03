import { describe, expect, it } from "vitest";
import type { SessionEntry } from "../config/sessions/types.js";
import {
  DEFAULT_RESET_HISTORY_MAX,
  preservePreviousSessionAsResetEntry,
  resolveResetHistoryMax,
} from "./session-reset-preserve.js";

function entry(overrides: Partial<SessionEntry> & { sessionId: string }): SessionEntry {
  return { updatedAt: 1_000, ...overrides };
}

describe("resolveResetHistoryMax", () => {
  it("defaults to 10 when unset or invalid", () => {
    expect(resolveResetHistoryMax(undefined)).toBe(DEFAULT_RESET_HISTORY_MAX);
    expect(resolveResetHistoryMax({})).toBe(10);
    expect(resolveResetHistoryMax({ resetHistoryMax: -3 })).toBe(10);
    expect(resolveResetHistoryMax({ resetHistoryMax: Number.NaN })).toBe(10);
  });

  it("honors 0 (disabled) and floors fractional values", () => {
    expect(resolveResetHistoryMax({ resetHistoryMax: 0 })).toBe(0);
    expect(resolveResetHistoryMax({ resetHistoryMax: 2.9 })).toBe(2);
  });
});

describe("preservePreviousSessionAsResetEntry", () => {
  const baseKey = "agent:main:telegram:dm:42";

  it("re-keys the predecessor with reset metadata and archived transcript", () => {
    const store: Record<string, SessionEntry> = {};
    const result = preservePreviousSessionAsResetEntry({
      store,
      baseSessionKey: baseKey,
      previousEntry: entry({ sessionId: "old-1", sessionFile: "/s/old-1.jsonl", label: "Work" }),
      archivedSessionFile: "/s/old-1.jsonl.reset.2026",
      now: 5_000,
      maxPreserved: 10,
    });

    const preservedKey = `${baseKey}:reset:old-1`;
    expect(result.preservedKey).toBe(preservedKey);
    expect(result.pruned).toEqual([]);
    const preserved = store[preservedKey];
    expect(preserved?.resetHistory).toBe(true);
    expect(preserved?.resetOfSessionKey).toBe(baseKey);
    expect(preserved?.resetArchivedAt).toBe(5_000);
    expect(preserved?.sessionId).toBe("old-1");
    expect(preserved?.sessionFile).toBe("/s/old-1.jsonl.reset.2026");
    expect(preserved?.status).toBe("done");
    expect(preserved?.label).toBe("Work");
  });

  it("falls back to the original sessionFile when no archived path is given", () => {
    const store: Record<string, SessionEntry> = {};
    preservePreviousSessionAsResetEntry({
      store,
      baseSessionKey: baseKey,
      previousEntry: entry({ sessionId: "old-2", sessionFile: "/s/old-2.jsonl" }),
      now: 1,
      maxPreserved: 10,
    });
    expect(store[`${baseKey}:reset:old-2`]?.sessionFile).toBe("/s/old-2.jsonl");
  });

  it("strips live/transient runtime fields", () => {
    const store: Record<string, SessionEntry> = {};
    preservePreviousSessionAsResetEntry({
      store,
      baseSessionKey: baseKey,
      previousEntry: entry({
        sessionId: "old-3",
        lastHeartbeatText: "hb",
        liveModelSwitchPending: true,
        systemSent: true,
        abortedLastRun: true,
      }),
      now: 1,
      maxPreserved: 10,
    });
    const preserved = store[`${baseKey}:reset:old-3`];
    expect(preserved?.lastHeartbeatText).toBeUndefined();
    expect(preserved?.liveModelSwitchPending).toBeUndefined();
    expect(preserved?.systemSent).toBeUndefined();
    expect(preserved?.abortedLastRun).toBeUndefined();
  });

  it("is a no-op when disabled or the predecessor has no session id", () => {
    const store: Record<string, SessionEntry> = {};
    expect(
      preservePreviousSessionAsResetEntry({
        store,
        baseSessionKey: baseKey,
        previousEntry: entry({ sessionId: "x" }),
        now: 1,
        maxPreserved: 0,
      }).preservedKey,
    ).toBeUndefined();
    expect(
      preservePreviousSessionAsResetEntry({
        store,
        baseSessionKey: baseKey,
        previousEntry: undefined,
        now: 1,
        maxPreserved: 10,
      }).preservedKey,
    ).toBeUndefined();
    expect(Object.keys(store)).toEqual([]);
  });

  it("skips machine and already-preserved keys", () => {
    for (const key of [
      "agent:main:cron:job-1",
      "agent:main:subagent:abc",
      "agent:main:acp:xyz",
      "agent:main:telegram:dm:42:reset:old-9",
    ]) {
      const store: Record<string, SessionEntry> = {};
      const result = preservePreviousSessionAsResetEntry({
        store,
        baseSessionKey: key,
        previousEntry: entry({ sessionId: "p" }),
        now: 1,
        maxPreserved: 10,
      });
      expect(result.preservedKey).toBeUndefined();
      expect(Object.keys(store)).toEqual([]);
    }
  });

  it("evicts the oldest predecessor beyond the per-key cap", () => {
    const store: Record<string, SessionEntry> = {
      [`${baseKey}:reset:a`]: entry({
        sessionId: "a",
        sessionFile: "/s/a.jsonl",
        resetHistory: true,
        resetOfSessionKey: baseKey,
        resetArchivedAt: 100,
      }),
      [`${baseKey}:reset:b`]: entry({
        sessionId: "b",
        resetHistory: true,
        resetOfSessionKey: baseKey,
        resetArchivedAt: 200,
      }),
      // Unrelated predecessor for a different base key must be untouched.
      "agent:main:other:reset:z": entry({
        sessionId: "z",
        resetHistory: true,
        resetOfSessionKey: "agent:main:other",
        resetArchivedAt: 1,
      }),
    };
    const result = preservePreviousSessionAsResetEntry({
      store,
      baseSessionKey: baseKey,
      previousEntry: entry({ sessionId: "c" }),
      now: 300,
      maxPreserved: 2,
    });

    // Newest two kept (c@300, b@200); oldest (a@100) evicted and reported.
    expect(result.pruned).toEqual([
      { key: `${baseKey}:reset:a`, sessionId: "a", sessionFile: "/s/a.jsonl" },
    ]);
    expect(store[`${baseKey}:reset:a`]).toBeUndefined();
    expect(store[`${baseKey}:reset:b`]).toBeDefined();
    expect(store[`${baseKey}:reset:c`]).toBeDefined();
    expect(store["agent:main:other:reset:z"]).toBeDefined();
  });
});
