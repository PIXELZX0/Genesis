import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { withFileLock } from "../infra/file-lock.js";
import { loadJsonFile, saveJsonFile } from "../infra/json-file.js";
import {
  resolveContactStateDir,
  resolveContactStorePath,
  resolveLegacyContactStorePaths,
} from "./paths.js";
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

function createContactMap(): Record<string, Contact> {
  return Object.create(null) as Record<string, Contact>;
}

function setContactEntry(contacts: Record<string, Contact>, key: string, contact: Contact): void {
  Object.defineProperty(contacts, key, {
    configurable: true,
    enumerable: true,
    value: contact,
    writable: true,
  });
}

function emptyStore(): ContactStore {
  return { version: CONTACT_STORE_VERSION, contacts: createContactMap() };
}

function cloneStore(store: ContactStore): ContactStore {
  const contacts = createContactMap();
  for (const [key, contact] of Object.entries(store.contacts)) {
    setContactEntry(contacts, key, structuredClone(contact));
  }
  return { version: store.version, contacts };
}

function hasOwn(record: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function parseMessengerId(value: unknown): ContactMessengerId | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (
    !hasOwn(record, "channel") ||
    !hasOwn(record, "id") ||
    typeof record.channel !== "string" ||
    typeof record.id !== "string"
  ) {
    return undefined;
  }
  const channel = record.channel.trim();
  const id = record.id.trim();
  if (!channel || !id) {
    return undefined;
  }
  const username =
    hasOwn(record, "username") && typeof record.username === "string"
      ? record.username.trim()
      : undefined;
  return { channel, id, ...(username ? { username } : {}) };
}

function parseContact(value: unknown): Contact | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (
    !hasOwn(record, "id") ||
    !hasOwn(record, "name") ||
    !hasOwn(record, "messengerIds") ||
    !hasOwn(record, "createdAt") ||
    !hasOwn(record, "updatedAt") ||
    typeof record.id !== "string" ||
    typeof record.name !== "string" ||
    !Array.isArray(record.messengerIds) ||
    typeof record.createdAt !== "number" ||
    !Number.isFinite(record.createdAt) ||
    typeof record.updatedAt !== "number" ||
    !Number.isFinite(record.updatedAt)
  ) {
    return undefined;
  }
  const id = record.id.trim();
  const name = record.name.trim();
  if (!id || !name) {
    return undefined;
  }
  const messengerIds = uniqueMessengerIds(
    record.messengerIds.flatMap((entry) => {
      const messenger = parseMessengerId(entry);
      return messenger ? [messenger] : [];
    }),
  );
  const contact: Contact = {
    id,
    name,
    messengerIds,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
  if (hasOwn(record, "age") && typeof record.age === "number" && Number.isFinite(record.age)) {
    contact.age = record.age;
  }
  if (hasOwn(record, "education") && typeof record.education === "string") {
    contact.education = record.education;
  }
  if (
    hasOwn(record, "traits") &&
    Array.isArray(record.traits) &&
    record.traits.every((trait) => typeof trait === "string")
  ) {
    contact.traits = record.traits;
  }
  if (hasOwn(record, "notes") && typeof record.notes === "string") {
    contact.notes = record.notes;
  }
  return contact;
}

function parseContactStore(value: unknown): ContactStore | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (
    !hasOwn(record, "contacts") ||
    !record.contacts ||
    typeof record.contacts !== "object" ||
    Array.isArray(record.contacts)
  ) {
    return undefined;
  }
  const candidates: Array<{
    key: string;
    contact: Contact;
    normalizedId: string;
    normalizedKey: string;
  }> = [];
  for (const [key, value] of Object.entries(record.contacts)) {
    const contact = parseContact(value);
    if (contact) {
      candidates.push({
        key,
        contact,
        normalizedId: normalizeToken(contact.id),
        normalizedKey: normalizeToken(key),
      });
    }
  }

  const quarantined = new Set<(typeof candidates)[number]>();
  const normalizedTokenOwners = new Map<string, Set<(typeof candidates)[number]>>();
  for (const candidate of candidates) {
    for (const value of [candidate.normalizedId, candidate.normalizedKey]) {
      const owners = normalizedTokenOwners.get(value) ?? new Set();
      owners.add(candidate);
      normalizedTokenOwners.set(value, owners);
    }
  }
  for (const entries of normalizedTokenOwners.values()) {
    if (entries.size < 2) {
      continue;
    }
    for (const entry of entries) {
      quarantined.add(entry);
    }
  }

  const messengerOwners = new Map<string, Set<string>>();
  for (const candidate of candidates) {
    for (const messenger of candidate.contact.messengerIds) {
      const owners = messengerOwners.get(messengerKey(messenger)) ?? new Set<string>();
      owners.add(candidate.normalizedId);
      messengerOwners.set(messengerKey(messenger), owners);
    }
  }
  for (const owners of messengerOwners.values()) {
    if (owners.size < 2) {
      continue;
    }
    for (const candidate of candidates) {
      if (owners.has(candidate.normalizedId)) {
        quarantined.add(candidate);
      }
    }
  }

  const contacts = createContactMap();
  const acceptedIds = new Set<string>();
  for (const candidate of candidates) {
    if (quarantined.has(candidate) || acceptedIds.has(candidate.normalizedId)) {
      continue;
    }
    setContactEntry(contacts, candidate.key, candidate.contact);
    acceptedIds.add(candidate.normalizedId);
  }
  return {
    version:
      hasOwn(record, "version") &&
      typeof record.version === "number" &&
      Number.isFinite(record.version)
        ? record.version
        : CONTACT_STORE_VERSION,
    contacts,
  };
}

function readPersistedStore(pathname: string): ContactStore | undefined {
  return parseContactStore(loadJsonFile(pathname));
}

export type ContactStoreLoadOptions = {
  legacyAgentDirs?: readonly string[];
};

function messengerKey(messenger: ContactMessengerId): string {
  return `${normalizeToken(messenger.channel)}:${normalizeToken(messenger.id)}`;
}

function sameContact(a: Contact, b: Contact): boolean {
  return isDeepStrictEqual(a, b);
}

/**
 * Merge only unambiguous legacy records. Conflicting ids or messenger identities
 * stay in their original files rather than being overwritten or guessed together.
 */
function loadLegacyContactStore(stateDir: string, options?: ContactStoreLoadOptions): ContactStore {
  const merged = emptyStore();
  const records: Contact[] = [];

  for (const pathname of resolveLegacyContactStorePaths(stateDir, options?.legacyAgentDirs)) {
    const legacy = readPersistedStore(pathname);
    if (!legacy) {
      continue;
    }
    records.push(...Object.values(legacy.contacts).toSorted((a, b) => a.id.localeCompare(b.id)));
  }

  const conflictingContactIds = new Set<string>();
  const contactsById = new Map<string, Contact[]>();
  for (const contact of records) {
    const contactId = normalizeToken(contact.id);
    const contacts = contactsById.get(contactId) ?? [];
    contacts.push(contact);
    contactsById.set(contactId, contacts);
  }
  for (const [contactId, contacts] of contactsById) {
    const first = contacts[0];
    if (first && contacts.some((contact) => !sameContact(first, contact))) {
      conflictingContactIds.add(contactId);
    }
  }

  const messengerOwners = new Map<string, Set<string>>();
  for (const contact of records) {
    for (const messenger of contact.messengerIds) {
      const owners = messengerOwners.get(messengerKey(messenger)) ?? new Set<string>();
      owners.add(normalizeToken(contact.id));
      messengerOwners.set(messengerKey(messenger), owners);
    }
  }
  for (const owners of messengerOwners.values()) {
    if (owners.size > 1) {
      for (const owner of owners) {
        conflictingContactIds.add(owner);
      }
    }
  }

  const mergedContactIds = new Set<string>();
  for (const contact of records) {
    const contactId = normalizeToken(contact.id);
    if (conflictingContactIds.has(contactId) || mergedContactIds.has(contactId)) {
      continue;
    }
    setContactEntry(merged.contacts, contact.id, structuredClone(contact));
    mergedContactIds.add(contactId);
  }

  return merged;
}

function readMtimeMs(pathname: string): number | null {
  try {
    return fs.statSync(pathname).mtimeMs;
  } catch {
    return null;
  }
}

function persistedStoreExists(pathname: string): boolean {
  try {
    fs.lstatSync(pathname);
    return true;
  } catch {
    return false;
  }
}

function normalizeToken(value: string | undefined | null): string {
  return (value ?? "").trim().toLowerCase();
}

function findContactEntryById(
  store: ContactStore,
  contactId: string | undefined | null,
): [string, Contact] | undefined {
  const normalizedId = normalizeToken(contactId);
  if (!normalizedId) {
    return undefined;
  }
  const matches = Object.entries(store.contacts).filter(
    ([key, contact]) =>
      contact &&
      (normalizeToken(contact.id) === normalizedId || normalizeToken(key) === normalizedId),
  );
  if (matches.length === 1) {
    return matches[0];
  }
  return undefined;
}

/** Find a contact by canonical id without treating case as significant. */
export function findContactById(
  store: ContactStore,
  contactId: string | undefined | null,
): Contact | undefined {
  return findContactEntryById(store, contactId)?.[1];
}

function uniqueMessengerIds(messengers: readonly ContactMessengerId[]): ContactMessengerId[] {
  const seen = new Set<string>();
  return messengers.filter((messenger) => {
    const key = messengerKey(messenger);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function normalizeContactString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

function normalizeMessengerId(value: unknown): ContactMessengerId | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const channel = normalizeContactString(record.channel);
  const id = normalizeContactString(record.id);
  if (!channel || !id) {
    return undefined;
  }
  const username = normalizeContactString(record.username);
  return { channel, id, ...(username ? { username } : {}) };
}

function normalizeIncomingMessengerIds(value: unknown): ContactMessengerId[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return uniqueMessengerIds(
    value.flatMap((entry) => {
      const messenger = normalizeMessengerId(entry);
      return messenger ? [messenger] : [];
    }),
  );
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

/** Load the shared contact store, cached by global file mtime. */
export function loadContactStore(
  stateDir?: string,
  options?: ContactStoreLoadOptions,
): ContactStore {
  const resolvedStateDir = resolveContactStateDir(stateDir);
  const pathname = resolveContactStorePath(resolvedStateDir);
  const mtimeMs = readMtimeMs(pathname);
  const hasPersistedStore = persistedStoreExists(pathname);
  const cached = loadedContactStoreCache.get(pathname);
  if (cached && cached.mtimeMs === mtimeMs) {
    return cloneStore(cached.store);
  }
  const persisted = readPersistedStore(pathname);
  // Once the shared file exists it is authoritative, even if malformed. Do not
  // silently route against stale legacy records in that case.
  const store =
    persisted ??
    (hasPersistedStore ? emptyStore() : loadLegacyContactStore(resolvedStateDir, options));
  if (hasPersistedStore) {
    loadedContactStoreCache.set(pathname, {
      mtimeMs: readMtimeMs(pathname),
      store: cloneStore(store),
    });
  }
  return store;
}

/** Persist the contact store and refresh the in-memory cache. */
export function saveContactStore(store: ContactStore, stateDir?: string): void {
  const pathname = resolveContactStorePath(stateDir);
  const safeStore = parseContactStore(store) ?? emptyStore();
  saveJsonFile(pathname, safeStore);
  loadedContactStoreCache.set(pathname, {
    mtimeMs: readMtimeMs(pathname),
    store: cloneStore(safeStore),
  });
}

/** Lock-guarded read-modify-write; updater returns true to persist. */
export async function updateContactStoreWithLock(params: {
  stateDir?: string;
  legacyAgentDirs?: readonly string[];
  updater: (store: ContactStore) => boolean;
}): Promise<ContactStore | null> {
  const resolvedStateDir = resolveContactStateDir(params.stateDir);
  const pathname = resolveContactStorePath(resolvedStateDir);
  try {
    return await withFileLock(pathname, CONTACT_STORE_LOCK_OPTIONS, async () => {
      // Reload from disk inside the lock so concurrent writers don't clobber.
      const hasPersistedStore = persistedStoreExists(pathname);
      const persisted = readPersistedStore(pathname);
      const store =
        persisted ??
        (hasPersistedStore
          ? emptyStore()
          : loadLegacyContactStore(resolvedStateDir, { legacyAgentDirs: params.legacyAgentDirs }));
      const shouldSave = params.updater(store);
      if (shouldSave) {
        saveContactStore(store, resolvedStateDir);
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
    if (!contact || !Array.isArray(contact.messengerIds)) {
      continue;
    }
    for (const messenger of contact.messengerIds) {
      if (!messenger || typeof messenger.channel !== "string" || typeof messenger.id !== "string") {
        continue;
      }
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
  const inputId = normalizeContactString(input.id);
  const inputName = normalizeContactString(input.name);
  const incomingMessengers = normalizeIncomingMessengerIds(input.messengerIds);

  let existing: Contact | undefined = inputId ? findContactById(store, inputId) : undefined;
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
      const name = normalizeContactString(input.name);
      if (name) {
        existing.name = name;
      }
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
        const owner = findContactByMessengerId(store, messenger.channel, messenger.id);
        if (owner && owner !== existing) {
          continue;
        }
        existing.messengerIds.push(messenger);
      }
    }
    existing.updatedAt = now;
    return existing;
  }

  const id = inputId || slugifyContactId(inputName);
  let uniqueId = id;
  while (findContactById(store, uniqueId)) {
    uniqueId = `${id}-${randomUUID().slice(0, 6)}`;
  }
  const contact: Contact = {
    id: uniqueId,
    name: inputName ?? uniqueId,
    ...(input.age !== undefined ? { age: input.age } : {}),
    ...(input.education !== undefined ? { education: input.education } : {}),
    ...(input.traits !== undefined ? { traits: input.traits } : {}),
    ...(input.notes !== undefined ? { notes: input.notes } : {}),
    messengerIds: incomingMessengers.filter(
      (messenger) => !findContactByMessengerId(store, messenger.channel, messenger.id),
    ),
    createdAt: now,
    updatedAt: now,
  };
  setContactEntry(store.contacts, uniqueId, contact);
  return contact;
}

/** Add a messenger identity to an existing contact. Returns false if absent or duplicate. */
export function addMessengerId(
  store: ContactStore,
  contactId: string,
  messenger: ContactMessengerId,
): boolean {
  const contact = findContactById(store, contactId);
  if (!contact) {
    return false;
  }
  if (contact.messengerIds.some((m) => sameMessenger(m, messenger))) {
    return false;
  }
  const owner = findContactByMessengerId(store, messenger.channel, messenger.id);
  if (owner && owner !== contact) {
    return false;
  }
  contact.messengerIds.push(messenger);
  contact.updatedAt = Date.now();
  return true;
}

export function deleteContact(store: ContactStore, contactId: string): boolean {
  const entry = findContactEntryById(store, contactId);
  if (!entry) {
    return false;
  }
  delete store.contacts[entry[0]];
  return true;
}

/** Test-only: clear the in-memory mtime cache. */
export function clearContactStoreCacheForTest(): void {
  loadedContactStoreCache.clear();
}
