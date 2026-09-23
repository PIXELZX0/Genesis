import type { Agent } from "@earendil-works/pi-agent-core";
import { getLatestCompactionEntry, type SessionManager } from "@earendil-works/pi-coding-agent";

type ProjectableSession = {
  agent: Pick<Agent, "prepareRequest" | "prepareNextTurnWithContext">;
  sessionManager: Pick<SessionManager, "getBranch">;
};

/**
 * Keep the agent loop's own context as the provider request history.
 *
 * Since pi 0.87, AgentSession rebuilds every request and next-turn context from
 * `sessionManager.buildSessionProjection()`, so the history Genesis assigns to
 * `agent.state.messages` before prompting (history limits, context-engine
 * assembly, replay sanitization, image pruning) is dropped. The loop context is
 * seeded from `agent.state.messages` and grows with the run, so it is the 0.86
 * request history. The session hooks still run for their other effects (system
 * prompt/tool loadout updates, threshold compaction); after a mid-run compaction
 * the compacted session context wins, as it did in 0.86.
 *
 * Must be installed after the session is created so it wraps the session hooks.
 */
export function installLoopContextProjection(session: ProjectableSession): void {
  const { agent, sessionManager } = session;
  const latestCompactionId = () => getLatestCompactionEntry(sessionManager.getBranch())?.id ?? null;

  const sessionPrepareRequest = agent.prepareRequest;
  if (sessionPrepareRequest) {
    agent.prepareRequest = async (request, signal) => {
      const update = (await sessionPrepareRequest(request, signal)) ?? undefined;
      if (!update?.context) {
        return update;
      }
      return { ...update, context: { ...update.context, messages: request.context.messages } };
    };
  }

  const sessionPrepareNextTurn = agent.prepareNextTurnWithContext;
  if (sessionPrepareNextTurn) {
    agent.prepareNextTurnWithContext = async (turn, signal) => {
      const compactionBefore = latestCompactionId();
      const update = await sessionPrepareNextTurn(turn, signal);
      if (!update?.context || latestCompactionId() !== compactionBefore) {
        return update;
      }
      return { ...update, context: { ...update.context, messages: turn.context.messages } };
    };
  }
}
