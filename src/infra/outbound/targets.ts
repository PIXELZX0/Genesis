import type { ChannelOutboundTargetMode } from "../../channels/plugins/types.core.js";
import type { GenesisConfig } from "../../config/types.genesis.js";
import { INTERNAL_MESSAGE_CHANNEL } from "../../utils/message-channel.js";
import type { GatewayMessageChannel } from "../../utils/message-channel.js";
import { resolveOutboundChannelPlugin } from "./channel-resolution.js";
import {
  resolveOutboundTargetWithPlugin,
  type OutboundTargetResolution,
} from "./targets-resolve-shared.js";

export type OutboundChannel = import("../../utils/message-channel.js").DeliverableMessageChannel;

export type OutboundTarget = {
  channel: OutboundChannel;
  to?: string;
  reason?: string;
  accountId?: string;
  threadId?: string | number;
  lastChannel?: OutboundChannel;
  lastAccountId?: string;
};

export type { OutboundTargetResolution } from "./targets-resolve-shared.js";
export { resolveSessionDeliveryTarget, type SessionDeliveryTarget } from "./targets-session.js";
import { resolveSessionDeliveryTarget, type SessionDeliveryTarget } from "./targets-session.js";

// Channel docking: prefer plugin.outbound.resolveTarget + allowFrom to normalize destinations.
export function resolveOutboundTarget(params: {
  channel: GatewayMessageChannel;
  to?: string;
  allowFrom?: string[];
  cfg?: GenesisConfig;
  accountId?: string | null;
  mode?: ChannelOutboundTargetMode;
}): OutboundTargetResolution {
  return (
    resolveOutboundTargetWithPlugin({
      plugin: resolveOutboundChannelPlugin({
        channel: params.channel,
        cfg: params.cfg,
      }),
      target: params,
      onMissingPlugin: () =>
        params.channel === INTERNAL_MESSAGE_CHANNEL
          ? undefined
          : {
              ok: false,
              error: new Error(`Unsupported channel: ${params.channel}`),
            },
    }) ?? {
      ok: false,
      error: new Error(`Unsupported channel: ${params.channel}`),
    }
  );
}
