import type { GenesisConfig } from "genesis/plugin-sdk/config-runtime";
import { buildOutboundBaseSessionKey } from "genesis/plugin-sdk/routing";
import { stripNextcloudTalkTargetPrefix } from "./normalize.js";

type NextcloudTalkOutboundSessionRouteParams = {
  cfg: GenesisConfig;
  agentId: string;
  accountId?: string | null;
  target: string;
};

export function resolveNextcloudTalkOutboundSessionRoute(
  params: NextcloudTalkOutboundSessionRouteParams,
) {
  const roomId = stripNextcloudTalkTargetPrefix(params.target);
  if (!roomId) {
    return null;
  }
  const baseSessionKey = buildOutboundBaseSessionKey({
    cfg: params.cfg,
    agentId: params.agentId,
    channel: "nextcloud-talk",
    accountId: params.accountId,
    peer: {
      kind: "group",
      id: roomId,
    },
  });
  return {
    sessionKey: baseSessionKey,
    baseSessionKey,
    peer: {
      kind: "group" as const,
      id: roomId,
    },
    chatType: "group" as const,
    from: `nextcloud-talk:room:${roomId}`,
    to: `nextcloud-talk:${roomId}`,
  };
}
