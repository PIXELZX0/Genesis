import { html, nothing } from "lit";
import {
  VOICE_AGENT_GATEWAY_TARGET,
  type VoiceAgentSessionStatus,
} from "../controllers/voice-agent.ts";
import { formatRelativeTimestamp } from "../format.ts";
import { icons } from "../icons.ts";
import type { NodesProps } from "./nodes.types.ts";

const STATE_DOT: Record<VoiceAgentSessionStatus["state"], string> = {
  listening: "status-dot--ok",
  thinking: "status-dot--warn",
  speaking: "status-dot--ok",
  stopped: "status-dot--idle",
};

function targetLabel(target: string, nodes: Array<Record<string, unknown>>): string {
  if (target === VOICE_AGENT_GATEWAY_TARGET) {
    return "Gateway host";
  }
  const node = nodes.find((entry) => entry.nodeId === target);
  return typeof node?.displayName === "string" && node.displayName.trim()
    ? node.displayName
    : target;
}

function renderSession(session: VoiceAgentSessionStatus, props: NodesProps) {
  const busy = props.voiceAgentBusyTarget === session.target;
  return html`
    <div
      class="table-row"
      style="grid-template-columns: 1fr 120px 72px 96px; align-items: flex-start;"
    >
      <div style="display: flex; flex-direction: column; gap: 4px; min-width: 0;">
        <span style="display: flex; align-items: center; gap: 8px; color: var(--text);">
          <span style="display: inline-flex; width: 16px; height: 16px;">${icons.mic}</span>
          ${targetLabel(session.target, props.nodes)}
        </span>
        ${session.lastTranscript
          ? html`<span class="muted" style="font-size: 13px;"
              >Heard: ${session.lastTranscript}</span
            >`
          : nothing}
        ${session.lastReply
          ? html`<span class="muted" style="font-size: 13px;">Replied: ${session.lastReply}</span>`
          : nothing}
        ${session.error
          ? html`<span class="callout danger" style="font-size: 13px;">${session.error}</span>`
          : nothing}
      </div>
      <span style="display: flex; align-items: center; gap: 8px;">
        <span class="status-dot ${STATE_DOT[session.state]}"></span>
        <span class="muted">${session.state}</span>
      </span>
      <span
        class="muted"
        title=${`Started ${formatRelativeTimestamp(Date.parse(session.startedAt))}`}
      >
        ${session.turns} ${session.turns === 1 ? "turn" : "turns"}
      </span>
      <span style="display: flex; justify-content: flex-end;">
        <button
          class="btn btn--sm"
          ?disabled=${busy}
          @click=${() => props.onVoiceAgentStop(session.target)}
        >
          ${busy ? "Stopping…" : "Stop"}
        </button>
      </span>
    </div>
  `;
}

export function renderVoiceAgent(props: NodesProps) {
  if (props.voiceAgentAvailable === null) {
    return nothing;
  }
  const gatewayActive = props.voiceAgentSessions.some(
    (session) => session.target === VOICE_AGENT_GATEWAY_TARGET,
  );
  return html`
    <section class="card">
      <div class="row" style="justify-content: space-between; align-items: flex-start; gap: 16px;">
        <div>
          <div class="card-title">Voice agent</div>
          <div class="card-sub">
            Talk to an agent through the gateway host's or a node's microphone and speaker.
          </div>
        </div>
        ${props.voiceAgentAvailable && !gatewayActive
          ? html`
              <button
                class="btn primary"
                ?disabled=${props.voiceAgentBusyTarget !== null}
                @click=${() => props.onVoiceAgentStart(null)}
              >
                ${props.voiceAgentBusyTarget === VOICE_AGENT_GATEWAY_TARGET
                  ? "Starting…"
                  : "Listen on gateway"}
              </button>
            `
          : nothing}
      </div>
      ${props.voiceAgentError
        ? html`<div class="callout danger" style="margin-top: 12px;">${props.voiceAgentError}</div>`
        : nothing}
      ${!props.voiceAgentAvailable
        ? html`<div class="muted" style="margin-top: 16px;">
            Enable the Voice Agent plugin (<code>plugins.entries.voice-agent.enabled</code>) and
            restart the gateway to use it.
          </div>`
        : props.voiceAgentSessions.length === 0
          ? html`<div class="muted" style="margin-top: 16px;">
              Not listening. Start on the gateway host, or from a node's action menu.
            </div>`
          : html`
              <div class="table" style="margin-top: 16px;">
                ${props.voiceAgentSessions.map((session) => renderSession(session, props))}
              </div>
            `}
    </section>
  `;
}
