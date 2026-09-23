import type { Agent, AgentMessage } from "@earendil-works/pi-agent-core";
import type { SessionManager } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { installLoopContextProjection } from "./loop-context-projection.js";

const user = (text: string) => ({ role: "user", content: text, timestamp: 0 }) as AgentMessage;

const windowed = [user("recent")];
const projected = [user("old"), user("recent")];

function createSession(branch: Array<{ type: string; id: string }> = []) {
  const agent: Pick<Agent, "prepareRequest" | "prepareNextTurnWithContext"> = {
    prepareRequest: async (request) => ({
      context: { ...request.context, messages: projected },
    }),
    prepareNextTurnWithContext: async (turn) => ({
      context: { ...turn.context, messages: projected },
      messages: [user("tool loadout update")],
    }),
  };
  const sessionManager = {
    getBranch: () => branch,
  } as unknown as Pick<SessionManager, "getBranch">;
  return { agent, sessionManager, branch };
}

describe("installLoopContextProjection", () => {
  it("sends the loop context instead of the session projection", async () => {
    const session = createSession();
    installLoopContextProjection(session);

    const request = await session.agent.prepareRequest?.({
      context: { messages: windowed, tools: [] },
      model: {} as never,
      thinkingLevel: "off",
    });
    expect(request?.context?.messages).toBe(windowed);

    const turn = await session.agent.prepareNextTurnWithContext?.({
      context: { messages: windowed, tools: [] },
    } as never);
    expect(turn?.context?.messages).toBe(windowed);
    expect(turn?.messages).toEqual([user("tool loadout update")]);
  });

  it("keeps the session context after a mid-run compaction", async () => {
    const session = createSession();
    const compactingPrepare = session.agent.prepareNextTurnWithContext;
    session.agent.prepareNextTurnWithContext = async (turn, signal) => {
      session.branch.push({ type: "compaction", id: "c1" });
      return await compactingPrepare?.(turn, signal);
    };
    installLoopContextProjection(session);

    const turn = await session.agent.prepareNextTurnWithContext?.({
      context: { messages: windowed, tools: [] },
    } as never);
    expect(turn?.context?.messages).toBe(projected);
  });
});
