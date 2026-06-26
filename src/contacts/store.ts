import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { withFileLock } from "../infra/file-lock.js";
import { loadJsonFile, saveJsonFile } from "../infra/json-file.js";
import { resolveContactStorePath } from "./paths.js";
import {
  type Contact,
  type ContactMessengerId,
  CONTACT_STORE_VERSION,
  type ContactStore,
} from "./types.js";

const CONTACT_STORE_LOCK_OPTIONS = {
  retries: {
    retries: 10,
    factor: 2,
    minTimeout: 100,
    maxTimeout: 10_000,
    randomize: true,
  },
  stale: 30_000,
} as const;

const loadedContactStoreCache = new Map<string, { mtimeMs: number | null; store: ContactStore }>();

function emptyStore(): ContactStore {
  return { version: CONTACT_STORE_VERSION, contacts: {} };
}

function cloneStore(store: ContactStore): ContactStore {
  return structuredClone(store);
}

function readMtimeMs(pathname: string): number | null {
  try {
    return fs.statSync(pathname).mtimeMs;
  } catch {
    return null;
  }
}

function normalizeToken(value: string | undefined | null): string {
  return (value ?? "").trim().toLowerCase();
}

/** Stable, filesystem-safe contact id derived from a name (or random fallback). */
export function slugifyContactId(value: string | undefined | null): string {
  const slug = normalizeToken(value)
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "")
    .slice(0, 64);
  return slug || `contact-${randomUUID().slice(0, 8)}`;
}

/** Load the contact store for an agent dir, cached by file mtime. */
export function loadContactStore(agentDir?: string): ContactStore {
  const pathname = resolveContactStorePath(agentDir);
  const mtimeMs = readMtimeMs(pathname);
  const cached = loadedContactStoreCache.get(pathname);
  if (cached && cached.mtimeMs === mtimeMs) {
    return cloneStore(cached.store);
  }
  const loaded = loadJsonFile<ContactStore>(pathname);
  const store: ContactStore =
    loaded && typeof loaded === "object" && loaded.contacts
      ? { version: loaded.version ?? CONTACT_STORE_VERSION, contacts: loaded.contacts }
      : emptyStore();
  loadedContactStoreCache.set(pathname, {
    mtimeMs: readMtimeMs(pathname),
    store: cloneStore(store),
  });
  return store;
}

/** Persist the contact store and refresh the in-memory cache. */
export function saveContactStore(store: ContactStore, agentDir?: string): void {
  const pathname = resolveContactStorePath(agentDir);
  saveJsonFile(pathname, store);
  loadedContactStoreCache.set(pathname, {
    mtimeMs: readMtimeMs(pathname),
    store: cloneStore(store),
  });
}

/** Lock-guarded read-modify-write; updater returns true to persist. */
export async function updateContactStoreWithLock(params: {
  agentDir?: string;
  updater: (store: ContactStore) => boolean;
}): Promise<ContactStore | null> {
  const pathname = resolveContactStorePath(params.agentDir);
  try {
    return await withFileLock(pathname, CONTACT_STORE_LOCK_OPTIONS, async () => {
      // Reload from disk inside the lock so concurrent writers don't clobber.
      const fresh = loadJsonFile<ContactStore>(pathname);
      const store: ContactStore =
        fresh && typeof fresh === "object" && fresh.contacts
          ? { version: fresh.version ?? CONTACT_STORE_VERSION, contacts: fresh.contacts }
          : emptyStore();
      const shouldSave = params.updater(store);
      if (shouldSave) {
        saveContactStore(store, params.agentDir);
      }
      return store;
    });
  } catch {
    return null;
  }
}

/** Find a contact owning the given messenger identity (case-insensitive). */
export function findContactByMessengerId(
  store: ContactStore,
  channel: string,
  id: string,
): Contact | undefined {
  const channelToken = normalizeToken(channel);
  const idToken = normalizeToken(id);
  if (!idToken) {
    return undefined;
  }
  for (const contact of Object.values(store.contacts)) {
    for (const messenger of contact.messengerIds) {
      if (
        normalizeToken(messenger.channel) === channelToken &&
        normalizeToken(messenger.id) === idToken
      ) {
        return contact;
      }
    }
  }
  return undefined;
}

function sameMessenger(a: ContactMessengerId, b: ContactMessengerId): boolean {
  return (
    normalizeToken(a.channel) === normalizeToken(b.channel) &&
    normalizeToken(a.id) === normalizeToken(b.id)
  );
}

export type UpsertContactInput = {
  id?: string;
  name?: string;
  age?: number;
  education?: string;
  traits?: string[];
  notes?: string;
  messengerIds?: ContactMessengerId[];
};

/**
 * Create or update a contact in-place. Matches an existing contact by `id`
 * first, else by any overlapping messenger identity. Returns the contact.
 */
export function upsertContact(store: ContactStore, input: UpsertContactInput): Contact {
  const now = Date.now();
  const incomingMessengers = input.messengerIds ?? [];

  let existing: Contact | undefined = input.id ? store.contacts[input.id] : undefined;
  if (!existing) {
    for (const messenger of incomingMessengers) {
      const match = findContactByMessengerId(store, messenger.channel, messenger.id);
      if (match) {
        existing = match;
        break;
      }
    }
  }

  if (existing) {
    if (input.name !== undefined) {
      existing.name = input.name;
    }
    if (input.age !== undefined) {
      existing.age = input.age;
    }
    if (input.education !== undefined) {
      existing.education = input.education;
    }
    if (input.traits !== undefined) {
      existing.traits = input.traits;
    }
    if (input.notes !== undefined) {
      existing.notes = input.notes;
    }
    for (const messenger of incomingMessengers) {
      if (!existing.messengerIds.some((m) => sameMessenger(m, messenger))) {
        existing.messengerIds.push(messenger);
      }
    }
    existing.updatedAt = now;
    return existing;
  }

  const id = input.id?.trim() || slugifyContactId(input.name);
  const uniqueId = store.contacts[id] ? `${id}-${randomUUID().slice(0, 6)}` : id;
  const contact: Contact = {
    id: uniqueId,
    name: input.name ?? uniqueId,
    ...(input.age !== undefined ? { age: input.age } : {}),
    ...(input.education !== undefined ? { education: input.education } : {}),
    ...(input.traits !== undefined ? { traits: input.traits } : {}),
    ...(input.notes !== undefined ? { notes: input.notes } : {}),
    messengerIds: incomingMessengers,
    createdAt: now,
    updatedAt: now,
  };
  store.contacts[uniqueId] = contact;
  return contact;
}

/** Add a messenger identity to an existing contact. Returns false if absent or duplicate. */
export function addMessengerId(
  store: ContactStore,
  contactId: string,
  messenger: ContactMessengerId,
): boolean {
  const contact = store.contacts[contactId];
  if (!contact) {
    return false;
  }
  if (contact.messengerIds.some((m) => sameMessenger(m, messenger))) {
    return false;
  }
  contact.messengerIds.push(messenger);
  contact.updatedAt = Date.now();
  return true;
}

export function deleteContact(store: ContactStore, contactId: string): boolean {
  if (!store.contacts[contactId]) {
    return false;
  }
  delete store.contacts[contactId];
  return true;
}

/** Test-only: clear the in-memory mtime cache. */
export function clearContactStoreCacheForTest(): void {
  loadedContactStoreCache.clear();
}
