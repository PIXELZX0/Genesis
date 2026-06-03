/**
 * Preserve the predecessor of a session that was cleared via `/new` or `/reset`.
 *
 * Without this, a reset overwrites the live store entry with a fresh session id
 * and archives (renames) the old transcript, leaving the prior session orphaned:
 * it is no longer enumerable by `sessions_list` nor readable by `sessions_history`.
 *
 * Here we copy the predecessor into a re-keyed entry
 * `<baseSessionKey>:reset:<oldSessionId>` whose `sessionFile` points at the
 * archived transcript and which is tagged `resetHistory`. The key keeps the
 * `agent:<id>:...` prefix, so it stays a same-agent session that the existing
 * session tools surface (as `kind:"reset"`) and read unchanged at
 * `tools.sessions.visibility: "agent"`.
 */

import type { SessionEntry } from "../config/sessions/types.js";
import type { SessionMaintenanceConfig } from "../config/types.base.js";
import {
  isAcpSessionKey,
  isCronSessionKey,
  isResetHistorySessionKey,
  isSubagentSessionKey,
} from "./session-key-utils.js";

export const DEFAULT_RESET_HISTORY_MAX = 10;

/** Resolve the per-key cap of preserved predecessors. `0` disables preservation. */
export function resolveResetHistoryMax(maintenance: SessionMaintenanceConfig | undefined): number {
  const raw = maintenance?.resetHistoryMax;
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) {
    return DEFAULT_RESET_HISTORY_MAX;
  }
  return Math.floor(raw);
}

/** Live/transient runtime state that must not linger on an archived predecessor. */
const STRIPPED_RESET_HISTORY_FIELDS: readonly (keyof SessionEntry)[] = [
  "lastHeartbeatText",
  "lastHeartbeatSentAt",
  "heartbeatTaskState",
  "heartbeatIsolatedBaseSessionKey",
  "liveModelSwitchPending",
  "systemSent",
  "abortedLastRun",
  "abortCutoffMessageSid",
  "abortCutoffTimestamp",
  "skillsSnapshot",
  "compactionCheckpoints",
  "pluginDebugEntries",
  "systemPromptReport",
];

export type PreservedResetPrune = { key: string; sessionId?: string; sessionFile?: string };

export type PreserveResetSessionResult = {
  /** Key under which the predecessor was preserved, when preservation applied. */
  preservedKey?: string;
  /** Predecessors evicted by the per-key cap (caller archives their transcripts). */
  pruned: PreservedResetPrune[];
};

/**
 * Mutate `store` to preserve the predecessor entry. Call INSIDE an
 * `updateSessionStore` mutator so the write is atomic under the store lock.
 *
 * `baseSessionKey` must be the canonical (normalized) live store key.
 */
export function preservePreviousSessionAsResetEntry(params: {
  store: Record<string, SessionEntry>;
  baseSessionKey: string;
  previousEntry: SessionEntry | undefined;
  /** Archived transcript path (`*.reset.<ts>`); preferred over the original. */
  archivedSessionFile?: string;
  now: number;
  maxPreserved: number;
}): PreserveResetSessionResult {
  const { store, baseSessionKey, previousEntry, archivedSessionFile, now, maxPreserved } = params;
  if (maxPreserved <= 0 || !previousEntry?.sessionId) {
    return { pruned: [] };
  }
  // Only preserve real user/conversation sessions. Machine sessions (cron,
  // subagent, acp) and already-preserved predecessors are skipped.
  if (
    isCronSessionKey(baseSessionKey) ||
    isSubagentSessionKey(baseSessionKey) ||
    isAcpSessionKey(baseSessionKey) ||
    isResetHistorySessionKey(baseSessionKey)
  ) {
    return { pruned: [] };
  }

  const preservedKey = `${baseSessionKey}:reset:${previousEntry.sessionId}`;
  const preservedEntry: SessionEntry = {
    ...previousEntry,
    sessionFile: archivedSessionFile ?? previousEntry.sessionFile,
    resetHistory: true,
    resetOfSessionKey: baseSessionKey,
    resetArchivedAt: now,
    status: "done",
    endedAt: previousEntry.endedAt ?? now,
  };
  const partial = preservedEntry as Partial<SessionEntry>;
  for (const field of STRIPPED_RESET_HISTORY_FIELDS) {
    delete partial[field];
  }
  store[preservedKey] = preservedEntry;

  // Enforce the per-base-key cap: keep the newest `maxPreserved`, prune the rest.
  const siblings = Object.keys(store)
    .filter((key) => {
      const entry = store[key];
      return entry?.resetHistory === true && entry.resetOfSessionKey === baseSessionKey;
    })
    .map((key) => ({ key, archivedAt: store[key]?.resetArchivedAt ?? 0 }))
    .toSorted((a, b) => b.archivedAt - a.archivedAt);

  const pruned: PreservedResetPrune[] = [];
  for (const sibling of siblings.slice(maxPreserved)) {
    const entry = store[sibling.key];
    pruned.push({ key: sibling.key, sessionId: entry?.sessionId, sessionFile: entry?.sessionFile });
    delete store[sibling.key];
  }

  return { preservedKey, pruned };
}
