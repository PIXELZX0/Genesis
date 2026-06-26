import type { GenesisConfig } from "../../config/types.genesis.js";
import {
  isContactSessionUnifyEnabled,
  resolveEffectiveIdentityLinks,
} from "../../routing/identity-links.runtime.js";
import { buildAgentSessionKey, type RoutePeer } from "../../routing/resolve-route.js";

export function buildOutboundBaseSessionKey(params: {
  cfg: GenesisConfig;
  agentId: string;
  channel: string;
  accountId?: string | null;
  peer: RoutePeer;
}): string {
  return buildAgentSessionKey({
    agentId: params.agentId,
    channel: params.channel,
    accountId: params.accountId,
    peer: params.peer,
    dmScope: params.cfg.session?.dmScope ?? "main",
    identityLinks: resolveEffectiveIdentityLinks({ cfg: params.cfg, agentId: params.agentId }),
    unifyContacts: isContactSessionUnifyEnabled(params.cfg),
  });
}
