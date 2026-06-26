import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  addMessengerId,
  clearContactStoreCacheForTest,
  deleteContact,
  findContactByMessengerId,
  loadContactStore,
  saveContactStore,
  slugifyContactId,
  updateContactStoreWithLock,
  upsertContact,
} from "./store.js";
import { CONTACT_STORE_FILENAME, CONTACT_STORE_VERSION } from "./types.js";

let agentDir: string;

beforeEach(() => {
  agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "genesis-contacts-"));
  clearContactStoreCacheForTest();
});

afterEach(() => {
  fs.rmSync(agentDir, { recursive: true, force: true });
  clearContactStoreCacheForTest();
});

describe("contact store", () => {
  it("returns an empty store when none exists", () => {
    const store = loadContactStore(agentDir);
    expect(store.version).toBe(CONTACT_STORE_VERSION);
    expect(store.contacts).toEqual({});
  });

  it("roundtrips save and load", () => {
    const store = loadContactStore(agentDir);
    upsertContact(store, {
      name: "Alice",
      age: 30,
      messengerIds: [{ channel: "telegram", id: "123" }],
    });
    saveContactStore(store, agentDir);
    expect(fs.existsSync(path.join(agentDir, CONTACT_STORE_FILENAME))).toBe(true);

    clearContactStoreCacheForTest();
    const reloaded = loadContactStore(agentDir);
    const alice = findContactByMessengerId(reloaded, "telegram", "123");
    expect(alice?.name).toBe("Alice");
    expect(alice?.age).toBe(30);
  });

  it("upserts by matching messenger id (cross-channel link)", () => {
    const store = loadContactStore(agentDir);
    const created = upsertContact(store, {
      name: "Bob",
      messengerIds: [{ channel: "telegram", id: "111" }],
    });
    const updated = upsertContact(store, {
      messengerIds: [
        { channel: "telegram", id: "111" },
        { channel: "discord", id: "abc" },
      ],
    });
    expect(updated.id).toBe(created.id);
    expect(updated.messengerIds).toHaveLength(2);
    expect(Object.keys(store.contacts)).toHaveLength(1);
  });

  it("matches messenger ids case-insensitively", () => {
    const store = loadContactStore(agentDir);
    upsertContact(store, { name: "Carol", messengerIds: [{ channel: "Discord", id: "ABC" }] });
    expect(findContactByMessengerId(store, "discord", "abc")?.name).toBe("Carol");
  });

  it("adds a messenger id only once", () => {
    const store = loadContactStore(agentDir);
    const c = upsertContact(store, { name: "Dan", messengerIds: [{ channel: "slack", id: "u1" }] });
    expect(addMessengerId(store, c.id, { channel: "telegram", id: "t1" })).toBe(true);
    expect(addMessengerId(store, c.id, { channel: "telegram", id: "t1" })).toBe(false);
    expect(store.contacts[c.id].messengerIds).toHaveLength(2);
  });

  it("deletes a contact", () => {
    const store = loadContactStore(agentDir);
    const c = upsertContact(store, { name: "Eve" });
    expect(deleteContact(store, c.id)).toBe(true);
    expect(deleteContact(store, c.id)).toBe(false);
    expect(store.contacts[c.id]).toBeUndefined();
  });

  it("persists via the lock-guarded updater", async () => {
    const result = await updateContactStoreWithLock({
      agentDir,
      updater: (s) => {
        upsertContact(s, { name: "Frank", messengerIds: [{ channel: "line", id: "L1" }] });
        return true;
      },
    });
    expect(result).not.toBeNull();
    clearContactStoreCacheForTest();
    expect(findContactByMessengerId(loadContactStore(agentDir), "line", "L1")?.name).toBe("Frank");
  });

  it("does not write when the updater returns false", async () => {
    await updateContactStoreWithLock({ agentDir, updater: () => false });
    expect(fs.existsSync(path.join(agentDir, CONTACT_STORE_FILENAME))).toBe(false);
  });

  it("slugifies names into filesystem-safe ids", () => {
    expect(slugifyContactId("John Doe")).toBe("john-doe");
    expect(slugifyContactId("  ")).toMatch(/^contact-/);
  });
});
