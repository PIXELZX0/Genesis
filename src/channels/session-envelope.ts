import { resolveEnvelopeFormatOptions } from "../auto-reply/envelope.js";
import { readSessionUpdatedAt, resolveStorePath } from "../config/sessions.js";
import type { GenesisConfig } from "../config/types.genesis.js";

export function resolveInboundSessionEnvelopeContext(params: {
  cfg: GenesisConfig;
  agentId: string;
  sessionKey: string;
}) {
  const storePath = resolveStorePath(params.cfg.session?.store, {
    agentId: params.agentId,
  });
  return {
    storePath,
    envelopeOptions: resolveEnvelopeFormatOptions(params.cfg),
    previousTimestamp: readSessionUpdatedAt({
      storePath,
      sessionKey: params.sessionKey,
    }),
  };
}
