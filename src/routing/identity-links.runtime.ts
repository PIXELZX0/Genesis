import { resolveAgentDir } from "../agents/agent-scope-config.js";
import type { GenesisConfig } from "../config/types.genesis.js";
import { getContactIdentityLinks } from "../contacts/identity-links.js";

/**
 * Union the operator-configured `session.identityLinks` with the per-agent
 * contact-derived links (when `session.contacts.enabled`). Returns `undefined`
 * when there are no links so callers keep their no-links fast path.
 */
export function resolveEffectiveIdentityLinks(params: {
  cfg: GenesisConfig | undefined;
  agentId: string | undefined | null;
}): Record<string, string[]> | undefined {
  const configLinks = params.cfg?.session?.identityLinks;
  const contactsEnabled = params.cfg?.session?.contacts?.enabled === true;
  if (!contactsEnabled) {
    return configLinks;
  }
  let contactLinks: Record<string, string[]> | undefined;
  try {
    const agentDir =
      params.cfg && params.agentId ? resolveAgentDir(params.cfg, params.agentId) : undefined;
    contactLinks = getContactIdentityLinks(agentDir);
  } catch {
    contactLinks = undefined;
  }
  if (!configLinks) {
    return contactLinks;
  }
  if (!contactLinks) {
    return configLinks;
  }
  // Config links win on key collision (operator override).
  return { ...contactLinks, ...configLinks };
}

/** Whether contact-driven DM session unification is active. */
export function isContactSessionUnifyEnabled(cfg: GenesisConfig | undefined): boolean {
  return cfg?.session?.contacts?.enabled === true && cfg?.session?.contacts?.unifySessions === true;
}
