import { logRejectedLargePayload } from "../logging/diagnostic-payload.js";
import {
  ADMIN_SCOPE,
  APPROVALS_SCOPE,
  PAIRING_SCOPE,
  READ_SCOPE,
  WRITE_SCOPE,
} from "./method-scopes.js";
import { GATEWAY_CLIENT_CAPS, hasGatewayClientCap } from "./protocol/client-info.js";
import type {
  GatewayBroadcastChatDeltaFn,
  GatewayBroadcastFn,
  GatewayBroadcastOpts,
  GatewayBroadcastStateVersion,
  GatewayBroadcastToConnIdsFn,
  GatewayChatDeltaPayloads,
} from "./server-broadcast-types.js";
import { MAX_BUFFERED_BYTES } from "./server-constants.js";
import type { GatewayWsClient } from "./server/ws-types.js";
import { logWs, shouldLogWs, summarizeAgentEventForWsLog } from "./ws-log.js";

// Pairing scope is for device-pairing handshakes only; chat transcript events
// require operator-level session access. Pairing-scoped and node-role clients
// must not passively receive chat-class broadcasts.
const EVENT_SCOPE_GUARDS: Record<string, string[]> = {
  agent: [READ_SCOPE],
  chat: [READ_SCOPE],
  "chat.side_result": [READ_SCOPE],
  cron: [READ_SCOPE],
  health: [],
  "exec.approval.requested": [APPROVALS_SCOPE],
  "exec.approval.resolved": [APPROVALS_SCOPE],
  heartbeat: [],
  "plugin.approval.requested": [APPROVALS_SCOPE],
  "plugin.approval.resolved": [APPROVALS_SCOPE],
  presence: [],
  shutdown: [],
  tick: [],
  "talk.mode": [WRITE_SCOPE],
  "update.available": [],
  "voicewake.changed": [READ_SCOPE],
  "device.pair.requested": [PAIRING_SCOPE],
  "device.pair.resolved": [PAIRING_SCOPE],
  "node.pair.requested": [PAIRING_SCOPE],
  "node.pair.resolved": [PAIRING_SCOPE],
  "sessions.changed": [READ_SCOPE],
  "session.message": [READ_SCOPE],
  "session.tool": [READ_SCOPE],
};

// Events that node-role sessions must receive even when the event's operator
// scope would otherwise reject non-operator roles. Nodes act on these updates
// (e.g. reconfiguring wake-word triggers).
const NODE_ALLOWED_EVENTS = new Set<string>(["voicewake.changed"]);

export type {
  GatewayBroadcastChatDeltaFn,
  GatewayBroadcastFn,
  GatewayBroadcastOpts,
  GatewayBroadcastStateVersion,
  GatewayBroadcastToConnIdsFn,
  GatewayChatDeltaPayloads,
} from "./server-broadcast-types.js";

function hasEventScope(client: GatewayWsClient, event: string): boolean {
  const required = EVENT_SCOPE_GUARDS[event];
  // Plugin-defined gateway broadcast events (plugin.* namespace) are allowed
  // for operator.write and operator.admin scopes. Explicit plugin.* entries
  // in EVENT_SCOPE_GUARDS take precedence (e.g., plugin.approval.*).
  if (!required && event.startsWith("plugin.")) {
    const role = client.connect.role ?? "operator";
    if (role !== "operator") {
      return false;
    }
    const scopes = Array.isArray(client.connect.scopes) ? client.connect.scopes : [];
    return scopes.includes(WRITE_SCOPE) || scopes.includes(ADMIN_SCOPE);
  }
  if (!required) {
    return false;
  }
  if (required.length === 0) {
    return true;
  }
  const role = client.connect.role ?? "operator";
  if (role !== "operator") {
    return role === "node" && NODE_ALLOWED_EVENTS.has(event);
  }
  const scopes = Array.isArray(client.connect.scopes) ? client.connect.scopes : [];
  if (scopes.includes(ADMIN_SCOPE)) {
    return true;
  }
  if (required.includes(READ_SCOPE)) {
    return scopes.includes(READ_SCOPE) || scopes.includes(WRITE_SCOPE);
  }
  return required.some((scope) => scopes.includes(scope));
}

function isAssistantAgentEvent(event: string, payload: unknown): boolean {
  return (
    event === "agent" &&
    payload !== null &&
    typeof payload === "object" &&
    (payload as { stream?: unknown }).stream === "assistant"
  );
}

export function createGatewayBroadcaster(params: { clients: Set<GatewayWsClient> }) {
  const clientSeq = new WeakMap<GatewayWsClient, number>();
  const reportedSlowPayloadClients = new WeakSet<GatewayWsClient>();

  const broadcastInternal = (
    event: string,
    payload: unknown,
    opts?: GatewayBroadcastOpts,
    targetConnIds?: ReadonlySet<string>,
    chatVariants?: GatewayChatDeltaPayloads,
  ) => {
    if (params.clients.size === 0) {
      return;
    }
    const isTargeted = Boolean(targetConnIds);
    const assistantAgentEvent = isAssistantAgentEvent(event, payload);
    const eligibleClients: GatewayWsClient[] = [];
    for (const client of params.clients) {
      if (targetConnIds && !targetConnIds.has(client.connId)) {
        continue;
      }
      if (!hasEventScope(client, event)) {
        continue;
      }
      if (
        assistantAgentEvent &&
        hasGatewayClientCap(
          client.connect.caps,
          GATEWAY_CLIENT_CAPS.SUPPRESS_ASSISTANT_AGENT_EVENTS,
        )
      ) {
        continue;
      }
      eligibleClients.push(client);
    }
    if (eligibleClients.length === 0) {
      return;
    }
    if (shouldLogWs()) {
      const logMeta: Record<string, unknown> = {
        event,
        seq: isTargeted ? "targeted" : "per-client",
        clients: params.clients.size,
        targets: targetConnIds ? targetConnIds.size : undefined,
        dropIfSlow: opts?.dropIfSlow,
        presenceVersion: opts?.stateVersion?.presence,
        healthVersion: opts?.stateVersion?.health,
      };
      if (event === "agent") {
        Object.assign(logMeta, summarizeAgentEventForWsLog(payload));
      }
      logWs("out", "event", logMeta);
    }
    // Only `seq` varies between recipients. Lazily serialize each selected
    // payload variant once, then assemble per-client frames by string splice.
    // This preserves the legacy JSON.stringify key order and omitted fields.
    let eventJson: string | undefined;
    let stateVersionPart: string | undefined;
    const buildFramePrefix = (framePayload: unknown): string => {
      eventJson ??= JSON.stringify(event);
      const framePayloadJson = JSON.stringify(framePayload);
      const payloadPart = framePayloadJson !== undefined ? `,"payload":${framePayloadJson}` : "";
      return `{"type":"event","event":${eventJson}${payloadPart}`;
    };
    const getStateVersionPart = (): string => {
      if (stateVersionPart === undefined) {
        stateVersionPart =
          opts?.stateVersion !== undefined
            ? `,"stateVersion":${JSON.stringify(opts.stateVersion)}`
            : "";
      }
      return stateVersionPart;
    };
    let framePrefix: string | undefined;
    let fullFramePrefix: string | undefined;
    let incrementalFramePrefix: string | undefined;
    const getFramePrefix = (client: GatewayWsClient): string => {
      if (!chatVariants) {
        return (framePrefix ??= buildFramePrefix(payload));
      }
      if (hasGatewayClientCap(client.connect.caps, GATEWAY_CLIENT_CAPS.CHAT_INCREMENTAL)) {
        return (incrementalFramePrefix ??= buildFramePrefix(chatVariants.incremental));
      }
      return (fullFramePrefix ??= buildFramePrefix(chatVariants.full));
    };
    for (const c of eligibleClients) {
      const nextSeq = (clientSeq.get(c) ?? 0) + 1;
      const slow = c.socket.bufferedAmount > MAX_BUFFERED_BYTES;
      if (!slow) {
        reportedSlowPayloadClients.delete(c);
      } else if (!reportedSlowPayloadClients.has(c)) {
        reportedSlowPayloadClients.add(c);
        logRejectedLargePayload({
          surface: "gateway.ws.outbound_buffer",
          bytes: c.socket.bufferedAmount,
          limitBytes: MAX_BUFFERED_BYTES,
          reason: opts?.dropIfSlow ? "ws_send_buffer_drop" : "ws_send_buffer_close",
        });
      }
      if (slow && opts?.dropIfSlow) {
        if (!isTargeted) {
          clientSeq.set(c, nextSeq);
        }
        continue;
      }
      if (slow) {
        try {
          c.socket.close(1008, "slow consumer");
        } catch {
          /* ignore */
        }
        continue;
      }
      try {
        const eventSeq = isTargeted ? undefined : nextSeq;
        if (!isTargeted) {
          clientSeq.set(c, nextSeq);
        }
        const seqPart = eventSeq !== undefined ? `,"seq":${eventSeq}` : "";
        const frame = `${getFramePrefix(c)}${seqPart}${getStateVersionPart()}}`;
        c.socket.send(frame);
      } catch {
        /* ignore */
      }
    }
  };

  const broadcast: GatewayBroadcastFn = (event, payload, opts) =>
    broadcastInternal(event, payload, opts);

  const broadcastToConnIds: GatewayBroadcastToConnIdsFn = (event, payload, connIds, opts) => {
    if (connIds.size === 0) {
      return;
    }
    broadcastInternal(event, payload, opts, connIds);
  };

  // Fan out a `chat` delta with per-connection payload selection: clients that
  // advertise the `chat-incremental` capability receive only the appended
  // suffix; all others receive the full transcript snapshot. Each needed
  // variant is serialized at most once across the fan-out.
  const broadcastChatDelta: GatewayBroadcastChatDeltaFn = (payloads, opts) =>
    broadcastInternal("chat", payloads.full, opts, undefined, payloads);

  return { broadcast, broadcastToConnIds, broadcastChatDelta };
}
