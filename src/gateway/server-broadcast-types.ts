export type GatewayBroadcastStateVersion = {
  presence?: number;
  health?: number;
};

export type GatewayBroadcastOpts = {
  dropIfSlow?: boolean;
  stateVersion?: GatewayBroadcastStateVersion;
};

export type GatewayBroadcastFn = (
  event: string,
  payload: unknown,
  opts?: GatewayBroadcastOpts,
) => void;

export type GatewayBroadcastToConnIdsFn = (
  event: string,
  payload: unknown,
  connIds: ReadonlySet<string>,
  opts?: GatewayBroadcastOpts,
) => void;

/**
 * Pre-built variants of a single `chat` delta payload. `full` carries the
 * complete assistant transcript snapshot (`message`); `incremental` carries
 * only the appended suffix (`appendText`/`reset`). The fan-out picks per
 * connection by the `chat-incremental` client capability.
 */
export type GatewayChatDeltaPayloads = {
  full: unknown;
  incremental: unknown;
};

export type GatewayBroadcastChatDeltaFn = (
  payloads: GatewayChatDeltaPayloads,
  opts?: GatewayBroadcastOpts,
) => void;
