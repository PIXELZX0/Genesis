import type { SessionLifecycleEvent } from "../sessions/session-lifecycle-events.js";
import type { SessionTranscriptUpdate } from "../sessions/transcript-events.js";
import type { GatewayBroadcastToConnIdsFn } from "./server-broadcast-types.js";
import type {
  SessionEventSubscriberRegistry,
  SessionMessageSubscriberRegistry,
} from "./server-chat.js";
import { resolveSessionKeyForTranscriptFile } from "./session-transcript-key.js";
import { createTranscriptSequenceTracker } from "./session-transcript-sequence.js";
import {
  attachGenesisTranscriptMeta,
  buildGatewaySessionRow,
  loadGatewaySessionRow,
  loadSessionEntry,
  type GatewaySessionRow,
} from "./session-utils.js";

type SessionEventSubscribers = Pick<
  SessionEventSubscriberRegistry,
  "getAll" | "getMessageSubscribers"
>;
type SessionMessageSubscribers = Pick<SessionMessageSubscriberRegistry, "get" | "hasAny">;

function buildGatewaySessionSnapshot(params: {
  sessionRow: GatewaySessionRow | null | undefined;
  includeSession?: boolean;
  label?: string;
  displayName?: string;
  parentSessionKey?: string;
}): Record<string, unknown> {
  const { sessionRow } = params;
  if (!sessionRow) {
    return {};
  }
  return {
    ...(params.includeSession ? { session: sessionRow } : {}),
    updatedAt: sessionRow.updatedAt ?? undefined,
    sessionId: sessionRow.sessionId,
    kind: sessionRow.kind,
    channel: sessionRow.channel,
    subject: sessionRow.subject,
    groupChannel: sessionRow.groupChannel,
    space: sessionRow.space,
    chatType: sessionRow.chatType,
    origin: sessionRow.origin,
    spawnedBy: sessionRow.spawnedBy,
    spawnedWorkspaceDir: sessionRow.spawnedWorkspaceDir,
    forkedFromParent: sessionRow.forkedFromParent,
    spawnDepth: sessionRow.spawnDepth,
    subagentRole: sessionRow.subagentRole,
    subagentControlScope: sessionRow.subagentControlScope,
    label: params.label ?? sessionRow.label,
    displayName: params.displayName ?? sessionRow.displayName,
    deliveryContext: sessionRow.deliveryContext,
    parentSessionKey: params.parentSessionKey ?? sessionRow.parentSessionKey,
    childSessions: sessionRow.childSessions,
    thinkingLevel: sessionRow.thinkingLevel,
    fastMode: sessionRow.fastMode,
    verboseLevel: sessionRow.verboseLevel,
    reasoningLevel: sessionRow.reasoningLevel,
    elevatedLevel: sessionRow.elevatedLevel,
    sendPolicy: sessionRow.sendPolicy,
    systemSent: sessionRow.systemSent,
    abortedLastRun: sessionRow.abortedLastRun,
    inputTokens: sessionRow.inputTokens,
    outputTokens: sessionRow.outputTokens,
    lastChannel: sessionRow.lastChannel,
    lastTo: sessionRow.lastTo,
    lastAccountId: sessionRow.lastAccountId,
    lastThreadId: sessionRow.lastThreadId,
    totalTokens: sessionRow.totalTokens,
    totalTokensFresh: sessionRow.totalTokensFresh,
    contextTokens: sessionRow.contextTokens,
    estimatedCostUsd: sessionRow.estimatedCostUsd,
    responseUsage: sessionRow.responseUsage,
    modelProvider: sessionRow.modelProvider,
    model: sessionRow.model,
    status: sessionRow.status,
    subagentRunState: sessionRow.subagentRunState,
    hasActiveSubagentRun: sessionRow.hasActiveSubagentRun,
    startedAt: sessionRow.startedAt,
    endedAt: sessionRow.endedAt,
    runtimeMs: sessionRow.runtimeMs,
    compactionCheckpointCount: sessionRow.compactionCheckpointCount,
    latestCompactionCheckpoint: sessionRow.latestCompactionCheckpoint,
  };
}

export function createTranscriptUpdateBroadcastHandler(params: {
  broadcastToConnIds: GatewayBroadcastToConnIdsFn;
  sessionEventSubscribers: SessionEventSubscribers;
  sessionMessageSubscribers: SessionMessageSubscribers;
}) {
  const transcriptSequence = createTranscriptSequenceTracker();
  return (update: SessionTranscriptUpdate): void => {
    if (update.message === undefined) {
      transcriptSequence.invalidate(update.sessionFile);
      return;
    }
    const sessionEventConnIds = params.sessionEventSubscribers.getAll();
    const globalMessageConnIds = params.sessionEventSubscribers.getMessageSubscribers();
    if (sessionEventConnIds.size === 0 && !params.sessionMessageSubscribers.hasAny()) {
      return;
    }
    const sessionKey = update.sessionKey ?? resolveSessionKeyForTranscriptFile(update.sessionFile);
    if (!sessionKey) {
      return;
    }
    const sessionMessageConnIds = params.sessionMessageSubscribers.get(sessionKey);
    const listOnlyConnIds = new Set<string>();
    for (const connId of sessionEventConnIds) {
      if (!globalMessageConnIds.has(connId) && !sessionMessageConnIds.has(connId)) {
        listOnlyConnIds.add(connId);
      }
    }
    if (
      globalMessageConnIds.size === 0 &&
      sessionMessageConnIds.size === 0 &&
      listOnlyConnIds.size === 0
    ) {
      return;
    }
    const connIds = new Set<string>(globalMessageConnIds);
    for (const connId of sessionMessageConnIds) {
      connIds.add(connId);
    }
    const { cfg, entry, store, storePath, canonicalKey } = loadSessionEntry(sessionKey);
    const messageSeq = entry?.sessionId
      ? transcriptSequence.read({
          sessionId: entry.sessionId,
          storePath,
          sessionFile: entry.sessionFile,
        })
      : undefined;
    const sessionSnapshot = buildGatewaySessionSnapshot({
      sessionRow: entry
        ? buildGatewaySessionRow({
            cfg,
            storePath,
            store,
            key: canonicalKey,
            entry,
          })
        : null,
      includeSession: true,
    });
    const message = attachGenesisTranscriptMeta(update.message, {
      ...(typeof update.messageId === "string" ? { id: update.messageId } : {}),
      ...(typeof messageSeq === "number" ? { seq: messageSeq } : {}),
    });
    if (connIds.size > 0) {
      params.broadcastToConnIds(
        "session.message",
        {
          sessionKey,
          message,
          ...(typeof update.messageId === "string" ? { messageId: update.messageId } : {}),
          ...(typeof messageSeq === "number" ? { messageSeq } : {}),
          ...sessionSnapshot,
        },
        connIds,
        { dropIfSlow: true },
      );
    }

    const sessionChangedPayload = {
      sessionKey,
      phase: "message",
      ts: Date.now(),
      ...(typeof update.messageId === "string" ? { messageId: update.messageId } : {}),
      ...(typeof messageSeq === "number" ? { messageSeq } : {}),
      ...sessionSnapshot,
    };
    // Preserve the paired row event for legacy global message subscribers.
    if (globalMessageConnIds.size > 0) {
      params.broadcastToConnIds("sessions.changed", sessionChangedPayload, globalMessageConnIds, {
        dropIfSlow: true,
      });
    }
    // Scoped Control UI clients still need list metadata for unrelated sessions,
    // but the active session already receives the row snapshot on session.message.
    if (listOnlyConnIds.size > 0) {
      params.broadcastToConnIds("sessions.changed", sessionChangedPayload, listOnlyConnIds, {
        dropIfSlow: true,
      });
    }
  };
}

export function createLifecycleEventBroadcastHandler(params: {
  broadcastToConnIds: GatewayBroadcastToConnIdsFn;
  sessionEventSubscribers: SessionEventSubscribers;
}) {
  return (event: SessionLifecycleEvent): void => {
    const connIds = params.sessionEventSubscribers.getAll();
    if (connIds.size === 0) {
      return;
    }
    params.broadcastToConnIds(
      "sessions.changed",
      {
        sessionKey: event.sessionKey,
        reason: event.reason,
        parentSessionKey: event.parentSessionKey,
        label: event.label,
        displayName: event.displayName,
        ts: Date.now(),
        ...buildGatewaySessionSnapshot({
          sessionRow: loadGatewaySessionRow(event.sessionKey),
          label: event.label,
          displayName: event.displayName,
          parentSessionKey: event.parentSessionKey,
        }),
      },
      connIds,
      { dropIfSlow: true },
    );
  };
}
