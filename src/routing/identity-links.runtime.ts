import type { GenesisConfig } from "../config/types.genesis.js";
import { isContactsEnabled, resolveContactLegacyAgentDirs } from "../contacts/config.js";
import { getContactIdentityLinks } from "../contacts/identity-links.js";

/**
 * Union the operator-configured `session.identityLinks` with the global
 * contact-derived links when explicitly requested. Configured links are
 * always preserved; `includeContactLinks` only controls the contact scan.
 */
export function resolveEffectiveIdentityLinks(params: {
  cfg: GenesisConfig | undefined;
  agentId: string | undefined | null;
  agentDir?: string;
  stateDir?: string;
  includeContactLinks: boolean;
}): Record<string, string[]> | undefined {
  const configLinks = params.cfg?.session?.identityLinks;
  const contactsEnabled = isContactsEnabled(params.cfg);
  if (!params.includeContactLinks || !contactsEnabled) {
    return configLinks;
  }
  let contactLinks: Record<string, string[]> | undefined;
  try {
    contactLinks = getContactIdentityLinks(params.stateDir, {
      legacyAgentDirs: resolveContactLegacyAgentDirs(params.cfg, {
        stateDir: params.stateDir,
        agentDir: params.agentDir,
      }),
    });
  } catch {
    contactLinks = undefined;
  }
  if (!configLinks) {
    return contactLinks;
  }
  if (!contactLinks) {
    return configLinks;
  }
  const mergedLinks: Record<string, string[]> = Object.create(null) as Record<string, string[]>;
  const configuredKeys = new Set(Object.keys(configLinks).map((key) => key.toLowerCase()));
  for (const [key, ids] of Object.entries(contactLinks)) {
    if (configuredKeys.has(key.toLowerCase())) {
      continue;
    }
    Object.defineProperty(mergedLinks, key, {
      configurable: true,
      enumerable: true,
      value: ids,
      writable: true,
    });
  }
  // Config links win on key collision (operator override), including case-only differences.
  for (const [key, ids] of Object.entries(configLinks)) {
    Object.defineProperty(mergedLinks, key, {
      configurable: true,
      enumerable: true,
      value: ids,
      writable: true,
    });
  }
  return mergedLinks;
}

/** Whether contact-driven DM session unification is active. */
export function isContactSessionUnifyEnabled(cfg: GenesisConfig | undefined): boolean {
  return isContactsEnabled(cfg) && cfg?.session?.contacts?.unifySessions === true;
}
