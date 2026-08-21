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
  const dmScope = params.cfg.session?.dmScope ?? "main";
  const unifyContacts = isContactSessionUnifyEnabled(params.cfg);
  const shouldResolveIdentityLinks =
    params.peer.kind === "direct" &&
    (dmScope !== "main" || unifyContacts) &&
    (unifyContacts || params.cfg.session?.identityLinks !== undefined);
  return buildAgentSessionKey({
    agentId: params.agentId,
    channel: params.channel,
    accountId: params.accountId,
    peer: params.peer,
    dmScope,
    identityLinks: shouldResolveIdentityLinks
      ? resolveEffectiveIdentityLinks({
          cfg: params.cfg,
          agentId: params.agentId,
          includeContactLinks: unifyContacts,
        })
      : undefined,
    unifyContacts,
  });
}
