import { describe, expect, it, vi } from "vitest";
import {
  loadVoiceAgentStatus,
  startVoiceAgent,
  stopVoiceAgent,
  type VoiceAgentState,
} from "./voice-agent.ts";

function createState(): { request: ReturnType<typeof vi.fn>; state: VoiceAgentState } {
  const request = vi.fn();
  return {
    request,
    state: {
      client: { request } as unknown as VoiceAgentState["client"],
      connected: true,
      voiceAgentAvailable: null,
      voiceAgentSessions: [],
      voiceAgentBusyTarget: null,
      voiceAgentError: null,
    },
  };
}

describe("voice agent controller", () => {
  it("marks the plugin unavailable on unknown method and stops polling it", async () => {
    const { request, state } = createState();
    request.mockRejectedValue(new Error("unknown method: voiceagent.status"));
    await loadVoiceAgentStatus(state);
    expect(state.voiceAgentAvailable).toBe(false);
    expect(state.voiceAgentError).toBeNull();
    await loadVoiceAgentStatus(state);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("starts on a node, stops the gateway without a node param, and refreshes status", async () => {
    const { request, state } = createState();
    const session = { id: "s", target: "node-1", state: "listening", turns: 0 };
    request.mockImplementation(async (method: string) =>
      method === "voiceagent.status" ? { sessions: [session] } : {},
    );
    await startVoiceAgent(state, "node-1");
    await stopVoiceAgent(state, "gateway");
    expect(request.mock.calls).toEqual([
      ["voiceagent.start", { node: "node-1" }],
      ["voiceagent.status", {}],
      ["voiceagent.stop", {}],
      ["voiceagent.status", {}],
    ]);
    expect(state.voiceAgentSessions).toEqual([session]);
    expect(state.voiceAgentBusyTarget).toBeNull();
  });

  it("surfaces start errors", async () => {
    const { request, state } = createState();
    request.mockRejectedValueOnce(new Error("realtime transcription provider is not configured"));
    request.mockResolvedValue({ sessions: [] });
    await startVoiceAgent(state, null);
    expect(state.voiceAgentError).toContain("not configured");
  });
});
