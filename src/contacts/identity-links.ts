import { loadContactStore, type ContactStoreLoadOptions } from "./store.js";
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
  const links: Record<string, string[]> = Object.create(null) as Record<string, string[]>;
  for (const contact of Object.values(store.contacts)) {
    if (!contact || typeof contact.id !== "string" || !Array.isArray(contact.messengerIds)) {
      continue;
    }
    const contactId = contact.id.trim();
    if (!contactId) {
      continue;
    }
    const ids = contact.messengerIds.flatMap((messenger) => {
      if (!messenger || typeof messenger.channel !== "string" || typeof messenger.id !== "string") {
        return [];
      }
      const channel = messenger.channel.trim();
      const id = messenger.id.trim();
      return channel && id ? [`${channel}:${id}`] : [];
    });
    if (ids.length > 0) {
      Object.defineProperty(links, contactId, {
        configurable: true,
        enumerable: true,
        value: ids,
        writable: true,
      });
    }
  }
  return Object.keys(links).length > 0 ? links : undefined;
}

/**
 * Load (cached) the global contact store and derive its identity links.
 * Returns `undefined` when there are no usable contact identities so the
 * router can keep its no-links fast path.
 */
export function getContactIdentityLinks(
  stateDir?: string,
  options?: ContactStoreLoadOptions,
): Record<string, string[]> | undefined {
  return buildContactIdentityLinks(loadContactStore(stateDir, options));
}
