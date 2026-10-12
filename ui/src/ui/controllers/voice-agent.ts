import type { GatewayBrowserClient } from "../gateway.ts";

// Mirrors `VoiceAgentStatus` from the voice-agent plugin's `voiceagent.status` payload.
export type VoiceAgentSessionStatus = {
  id: string;
  target: string;
  sttProvider: string;
  state: "listening" | "thinking" | "speaking" | "stopped";
  startedAt: string;
  turns: number;
  lastTranscript?: string;
  lastReply?: string;
  error?: string;
};

export const VOICE_AGENT_NODE_COMMAND = "voiceagent.audio";
export const VOICE_AGENT_GATEWAY_TARGET = "gateway";

export type VoiceAgentState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  /** null until the first status call; false when the plugin's methods are not registered. */
  voiceAgentAvailable: boolean | null;
  voiceAgentSessions: VoiceAgentSessionStatus[];
  /** Target currently being started/stopped (`gateway` or a node id). */
  voiceAgentBusyTarget: string | null;
  voiceAgentError: string | null;
};

function isUnknownMethodError(err: unknown): boolean {
  return String(err).includes("unknown method");
}

export async function loadVoiceAgentStatus(state: VoiceAgentState, opts?: { quiet?: boolean }) {
  if (!state.client || !state.connected || state.voiceAgentAvailable === false) {
    return;
  }
  try {
    const res = await state.client.request<{ sessions?: VoiceAgentSessionStatus[] }>(
      "voiceagent.status",
      {},
    );
    state.voiceAgentAvailable = true;
    state.voiceAgentSessions = Array.isArray(res.sessions) ? res.sessions : [];
  } catch (err) {
    if (isUnknownMethodError(err)) {
      state.voiceAgentAvailable = false;
    } else if (!opts?.quiet) {
      state.voiceAgentError = String(err);
    }
  }
}

async function runVoiceAgentAction(
  state: VoiceAgentState,
  method: "voiceagent.start" | "voiceagent.stop",
  nodeId: string | null,
) {
  if (!state.client || !state.connected || state.voiceAgentBusyTarget) {
    return;
  }
  state.voiceAgentBusyTarget = nodeId ?? VOICE_AGENT_GATEWAY_TARGET;
  state.voiceAgentError = null;
  try {
    // Omitting `node` on start uses the plugin's configured default (gateway host unless set).
    await state.client.request(method, nodeId ? { node: nodeId } : {});
  } catch (err) {
    state.voiceAgentError = String(err);
  } finally {
    state.voiceAgentBusyTarget = null;
  }
  await loadVoiceAgentStatus(state, { quiet: true });
}

export function startVoiceAgent(state: VoiceAgentState, nodeId: string | null) {
  return runVoiceAgentAction(state, "voiceagent.start", nodeId);
}

export function stopVoiceAgent(state: VoiceAgentState, target: string) {
  return runVoiceAgentAction(
    state,
    "voiceagent.stop",
    target === VOICE_AGENT_GATEWAY_TARGET ? null : target,
  );
}
