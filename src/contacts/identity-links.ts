import { loadContactStore } from "./store.js";
import type { ContactStore } from "./types.js";

/**
 * Derive an `identityLinks` map from contacts: each contact id maps to its
 * messenger identities as `channel:id` strings. Shape matches
 * `session.identityLinks` so it can be unioned with config links and consumed
 * by `resolveLinkedPeerId()` in the router.
 */
export function buildContactIdentityLinks(
  store: ContactStore,
): Record<string, string[]> | undefined {
  const links: Record<string, string[]> = {};
  for (const contact of Object.values(store.contacts)) {
    const ids = contact.messengerIds
      .map((m) => `${m.channel.trim()}:${m.id.trim()}`)
      .filter((entry) => entry.length > 1 && !entry.startsWith(":") && !entry.endsWith(":"));
    if (ids.length > 0) {
      links[contact.id] = ids;
    }
  }
  return Object.keys(links).length > 0 ? links : undefined;
}

/**
 * Load (cached) the contact store for an agent dir and derive its identity
 * links. Returns `undefined` when there are no usable contact identities so
 * the router can keep its no-links fast path.
 */
export function getContactIdentityLinks(agentDir?: string): Record<string, string[]> | undefined {
  return buildContactIdentityLinks(loadContactStore(agentDir));
}
