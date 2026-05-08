import { getAgentRunContext } from "../infra/agent-events.js";
import { subagentRuns } from "./subagent-registry-memory.js";
import {
  countActiveDescendantRunsFromRuns,
  getSubagentRunByChildSessionKeyFromRuns,
  listDescendantRunsForRequesterFromRuns,
  listRunsForControllerFromRuns,
} from "./subagent-registry-queries.js";
import { getSubagentRunsSnapshotForRead } from "./subagent-registry-state.js";
import type { SubagentRunRecord } from "./subagent-registry.types.js";
import { isLiveUnendedSubagentRun } from "./subagent-run-liveness.js";
import {
  getSubagentSessionRuntimeMs,
  getSubagentSessionStartedAt,
  resolveSubagentSessionStatus,
} from "./subagent-session-metrics.js";

export {
  getSubagentSessionRuntimeMs,
  getSubagentSessionStartedAt,
  resolveSubagentSessionStatus,
} from "./subagent-session-metrics.js";

export function listSubagentRunsForController(controllerSessionKey: string): SubagentRunRecord[] {
  return listRunsForControllerFromRuns(
    getSubagentRunsSnapshotForRead(subagentRuns),
    controllerSessionKey,
  );
}

export function getSubagentRunsSnapshotForBulkRead(): Map<string, SubagentRunRecord> {
  return getSubagentRunsSnapshotForRead(subagentRuns);
}

export function listSessionDisplaySubagentRunsByChildSessionKey(): Map<string, SubagentRunRecord> {
  const result = new Map<string, SubagentRunRecord>();
  const inMemoryByChild = new Map<
    string,
    {
      latestActive?: SubagentRunRecord;
      latestEnded?: SubagentRunRecord;
    }
  >();

  for (const entry of subagentRuns.values()) {
    const childKey = entry.childSessionKey.trim();
    if (!childKey) {
      continue;
    }
    const current = inMemoryByChild.get(childKey) ?? {};
    if (typeof entry.endedAt === "number") {
      if (!current.latestEnded || entry.createdAt > current.latestEnded.createdAt) {
        current.latestEnded = entry;
      }
    } else if (!current.latestActive || entry.createdAt > current.latestActive.createdAt) {
      current.latestActive = entry;
    }
    inMemoryByChild.set(childKey, current);
  }

  for (const [childKey, current] of inMemoryByChild.entries()) {
    if (
      current.latestEnded &&
      (!current.latestActive || current.latestEnded.createdAt > current.latestActive.createdAt)
    ) {
      result.set(childKey, current.latestEnded);
      continue;
    }
    const latest = current.latestActive ?? current.latestEnded;
    if (latest) {
      result.set(childKey, latest);
    }
  }

  const snapshotByChild = new Map<
    string,
    {
      latestActive?: SubagentRunRecord;
      latestEnded?: SubagentRunRecord;
    }
  >();
  for (const entry of getSubagentRunsSnapshotForRead(subagentRuns).values()) {
    const childKey = entry.childSessionKey.trim();
    if (!childKey || result.has(childKey)) {
      continue;
    }
    const current = snapshotByChild.get(childKey) ?? {};
    if (isLiveUnendedSubagentRun(entry)) {
      if (!current.latestActive || entry.createdAt > current.latestActive.createdAt) {
        current.latestActive = entry;
      }
    } else if (!current.latestEnded || entry.createdAt > current.latestEnded.createdAt) {
      current.latestEnded = entry;
    }
    snapshotByChild.set(childKey, current);
  }

  for (const [childKey, current] of snapshotByChild.entries()) {
    const latest = current.latestActive ?? current.latestEnded;
    if (latest) {
      result.set(childKey, latest);
    }
  }

  return result;
}

export function countActiveDescendantRuns(rootSessionKey: string): number {
  return countActiveDescendantRunsFromRuns(
    getSubagentRunsSnapshotForRead(subagentRuns),
    rootSessionKey,
  );
}

export function listDescendantRunsForRequester(rootSessionKey: string): SubagentRunRecord[] {
  return listDescendantRunsForRequesterFromRuns(
    getSubagentRunsSnapshotForRead(subagentRuns),
    rootSessionKey,
  );
}

export function getSubagentRunByChildSessionKey(childSessionKey: string): SubagentRunRecord | null {
  return getSubagentRunByChildSessionKeyFromRuns(
    getSubagentRunsSnapshotForRead(subagentRuns),
    childSessionKey,
  );
}

export function isSubagentRunLive(
  entry: Pick<SubagentRunRecord, "runId" | "endedAt"> | null | undefined,
): boolean {
  if (!entry || typeof entry.endedAt === "number") {
    return false;
  }
  return Boolean(getAgentRunContext(entry.runId));
}

export function getSessionDisplaySubagentRunByChildSessionKey(
  childSessionKey: string,
): SubagentRunRecord | null {
  const key = childSessionKey.trim();
  if (!key) {
    return null;
  }

  let latestInMemoryActive: SubagentRunRecord | null = null;
  let latestInMemoryEnded: SubagentRunRecord | null = null;
  for (const entry of subagentRuns.values()) {
    if (entry.childSessionKey !== key) {
      continue;
    }
    if (typeof entry.endedAt === "number") {
      if (!latestInMemoryEnded || entry.createdAt > latestInMemoryEnded.createdAt) {
        latestInMemoryEnded = entry;
      }
      continue;
    }
    if (!latestInMemoryActive || entry.createdAt > latestInMemoryActive.createdAt) {
      latestInMemoryActive = entry;
    }
  }

  if (latestInMemoryEnded || latestInMemoryActive) {
    if (
      latestInMemoryEnded &&
      (!latestInMemoryActive || latestInMemoryEnded.createdAt > latestInMemoryActive.createdAt)
    ) {
      return latestInMemoryEnded;
    }
    return latestInMemoryActive ?? latestInMemoryEnded;
  }

  return getSubagentRunByChildSessionKey(key);
}

export function getLatestSubagentRunByChildSessionKey(
  childSessionKey: string,
): SubagentRunRecord | null {
  const key = childSessionKey.trim();
  if (!key) {
    return null;
  }

  let latest: SubagentRunRecord | null = null;
  for (const entry of getSubagentRunsSnapshotForRead(subagentRuns).values()) {
    if (entry.childSessionKey !== key) {
      continue;
    }
    if (!latest || entry.createdAt > latest.createdAt) {
      latest = entry;
    }
  }

  return latest;
}
