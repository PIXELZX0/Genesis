import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addMessengerId,
  clearContactStoreCacheForTest,
  deleteContact,
  findContactById,
  findContactByMessengerId,
  loadContactStore,
  saveContactStore,
  slugifyContactId,
  updateContactStoreWithLock,
  upsertContact,
} from "./store.js";
import { CONTACT_STORE_FILENAME, CONTACT_STORE_VERSION } from "./types.js";

let stateDir: string;

beforeEach(() => {
  stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "genesis-contacts-"));
  clearContactStoreCacheForTest();
});

afterEach(() => {
  fs.rmSync(stateDir, { recursive: true, force: true });
  vi.unstubAllEnvs();
  clearContactStoreCacheForTest();
});

describe("contact store", () => {
  it("returns an empty store when none exists", () => {
    const store = loadContactStore(stateDir);
    expect(store.version).toBe(CONTACT_STORE_VERSION);
    expect(store.contacts).toEqual({});
  });

  it("roundtrips save and load", () => {
    const store = loadContactStore(stateDir);
    upsertContact(store, {
      name: "Alice",
      age: 30,
      messengerIds: [{ channel: "telegram", id: "123" }],
    });
    saveContactStore(store, stateDir);
    expect(fs.existsSync(path.join(stateDir, CONTACT_STORE_FILENAME))).toBe(true);

    clearContactStoreCacheForTest();
    const reloaded = loadContactStore(stateDir);
    const alice = findContactByMessengerId(reloaded, "telegram", "123");
    expect(alice?.name).toBe("Alice");
    expect(alice?.age).toBe(30);
  });

  it("upserts by matching messenger id (cross-channel link)", () => {
    const store = loadContactStore(stateDir);
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

  it("does not attach a messenger identity owned by another contact", () => {
    const store = loadContactStore(stateDir);
    const alice = upsertContact(store, {
      name: "Alice",
      messengerIds: [{ channel: "telegram", id: "alice-1" }],
    });
    const bob = upsertContact(store, {
      name: "Bob",
      messengerIds: [{ channel: "discord", id: "bob-1" }],
    });

    expect(
      upsertContact(store, {
        id: alice.id,
        name: "Alice Updated",
        messengerIds: [{ channel: "discord", id: "BOB-1" }],
      }),
    ).toBe(alice);
    expect(alice.name).toBe("Alice Updated");
    expect(alice.messengerIds).toEqual([{ channel: "telegram", id: "alice-1" }]);
    expect(bob.messengerIds).toEqual([{ channel: "discord", id: "bob-1" }]);
    expect(addMessengerId(store, alice.id, { channel: "Discord", id: "bob-1" })).toBe(false);
  });

  it("treats explicit and generated contact ids case-insensitively", () => {
    const store = loadContactStore(stateDir);
    const explicit = upsertContact(store, { id: "Alice", name: "Alice" });
    const updated = upsertContact(store, { id: "alice", name: "Updated Alice" });
    const generated = upsertContact(store, { name: "alice" });

    expect(updated).toBe(explicit);
    expect(explicit.name).toBe("Updated Alice");
    expect(generated.id.toLowerCase()).not.toBe(explicit.id.toLowerCase());
    expect(Object.values(store.contacts)).toHaveLength(2);
  });

  it("matches messenger ids case-insensitively", () => {
    const store = loadContactStore(stateDir);
    upsertContact(store, { name: "Carol", messengerIds: [{ channel: "Discord", id: "ABC" }] });
    expect(findContactByMessengerId(store, "discord", "abc")?.name).toBe("Carol");
  });

  it("adds a messenger id only once", () => {
    const store = loadContactStore(stateDir);
    const c = upsertContact(store, { name: "Dan", messengerIds: [{ channel: "slack", id: "u1" }] });
    expect(addMessengerId(store, c.id, { channel: "telegram", id: "t1" })).toBe(true);
    expect(addMessengerId(store, c.id, { channel: "telegram", id: "t1" })).toBe(false);
    expect(store.contacts[c.id].messengerIds).toHaveLength(2);
  });

  it("deletes a contact", () => {
    const store = loadContactStore(stateDir);
    const c = upsertContact(store, { name: "Eve" });
    expect(deleteContact(store, c.id)).toBe(true);
    expect(deleteContact(store, c.id)).toBe(false);
    expect(store.contacts[c.id]).toBeUndefined();
  });

  it("persists via the lock-guarded updater", async () => {
    const result = await updateContactStoreWithLock({
      stateDir,
      updater: (s) => {
        upsertContact(s, { name: "Frank", messengerIds: [{ channel: "line", id: "L1" }] });
        return true;
      },
    });
    expect(result).not.toBeNull();
    clearContactStoreCacheForTest();
    expect(findContactByMessengerId(loadContactStore(stateDir), "line", "L1")?.name).toBe("Frank");
  });

  it("does not write when the updater returns false", async () => {
    await updateContactStoreWithLock({ stateDir, updater: () => false });
    expect(fs.existsSync(path.join(stateDir, CONTACT_STORE_FILENAME))).toBe(false);
  });

  it("uses the active state-dir override for the shared store", () => {
    vi.stubEnv("GENESIS_STATE_DIR", stateDir);
    const store = loadContactStore();
    upsertContact(store, {
      name: "Global Alice",
      messengerIds: [{ channel: "telegram", id: "global-1" }],
    });
    saveContactStore(store);

    expect(fs.existsSync(path.join(stateDir, CONTACT_STORE_FILENAME))).toBe(true);
    expect(findContactByMessengerId(loadContactStore(), "telegram", "global-1")?.name).toBe(
      "Global Alice",
    );
  });

  it("quarantines conflicting records from an existing global store", () => {
    const contact = (id: string, name: string, messengerId: string) => ({
      id,
      name,
      messengerIds: [{ channel: "telegram", id: messengerId }],
      createdAt: 1,
      updatedAt: 1,
    });
    fs.writeFileSync(
      path.join(stateDir, CONTACT_STORE_FILENAME),
      JSON.stringify({
        version: CONTACT_STORE_VERSION,
        contacts: {
          Alice: contact("Alice", "Alice", "alice"),
          alice: contact("alice", "Alice 2", "alice-2"),
          first: contact("first", "First", "shared"),
          second: contact("second", "Second", "SHARED"),
          safe: contact("safe", "Safe", "safe"),
        },
      }),
    );

    const store = loadContactStore(stateDir);
    expect(Object.keys(store.contacts)).toEqual(["safe"]);
  });

  it("quarantines records when a map key collides with another contact id", () => {
    const contact = (id: string, name: string) => ({
      id,
      name,
      messengerIds: [],
      createdAt: 1,
      updatedAt: 1,
    });
    fs.writeFileSync(
      path.join(stateDir, CONTACT_STORE_FILENAME),
      JSON.stringify({
        version: CONTACT_STORE_VERSION,
        contacts: {
          first: contact("second", "First"),
          second: contact("first", "Second"),
          safe: contact("safe", "Safe"),
        },
      }),
    );

    const store = loadContactStore(stateDir);
    expect(Object.keys(store.contacts)).toEqual(["safe"]);
    expect(findContactById(store, "first")).toBeUndefined();
    expect(deleteContact(store, "second")).toBe(false);
  });

  it("trims valid runtime strings and ignores invalid contact identities", () => {
    const store = loadContactStore(stateDir);
    const contact = upsertContact(store, {
      id: "  Alice  ",
      name: "  Alice Smith  ",
      messengerIds: [
        { channel: " telegram ", id: " 123 " },
        { channel: " ", id: "456" },
        { channel: "discord", id: "\t" },
      ],
    });

    expect(contact).toEqual(
      expect.objectContaining({
        id: "Alice",
        name: "Alice Smith",
        messengerIds: [{ channel: "telegram", id: "123" }],
      }),
    );
    saveContactStore(store, stateDir);
    clearContactStoreCacheForTest();
    expect(loadContactStore(stateDir).contacts).toEqual({ Alice: contact });
  });

  it("does not fall back to legacy records when the global store is malformed", () => {
    const legacyDir = path.join(stateDir, "agents", "main", "agent");
    fs.mkdirSync(legacyDir, { recursive: true });
    fs.writeFileSync(
      path.join(legacyDir, CONTACT_STORE_FILENAME),
      JSON.stringify({
        version: CONTACT_STORE_VERSION,
        contacts: {
          legacy: {
            id: "legacy",
            name: "Legacy",
            messengerIds: [{ channel: "telegram", id: "legacy" }],
            createdAt: 1,
            updatedAt: 1,
          },
        },
      }),
    );
    fs.writeFileSync(path.join(stateDir, CONTACT_STORE_FILENAME), "not-json");

    expect(loadContactStore(stateDir).contacts).toEqual({});
  });

  it("keeps unsafe contact keys and skips malformed global records or messengers", () => {
    const protoContact = {
      id: "__proto__",
      name: "Prototype Contact",
      messengerIds: [{ channel: "telegram", id: "proto" }],
      createdAt: 1,
      updatedAt: 1,
    };
    const validContact = {
      id: "valid",
      name: "Valid",
      messengerIds: [
        { channel: "telegram", id: "123" },
        null,
        { channel: "discord", id: 123 },
        { channel: "", id: "missing-channel" },
        { channel: "signal", id: "456" },
        { channel: "SIGNAL", id: "456" },
      ],
      createdAt: 1,
      updatedAt: 1,
    };
    const rawContacts = `{"__proto__":${JSON.stringify(protoContact)},"valid":${JSON.stringify(validContact)},"broken":null}`;
    fs.writeFileSync(
      path.join(stateDir, CONTACT_STORE_FILENAME),
      `{"version":${CONTACT_STORE_VERSION},"contacts":${rawContacts}}`,
    );

    const store = loadContactStore(stateDir);
    expect(Object.getPrototypeOf(store.contacts)).toBeNull();
    expect(Object.prototype.hasOwnProperty.call(store.contacts, "__proto__")).toBe(true);
    expect(Object.getOwnPropertyDescriptor(store.contacts, "__proto__")?.value).toEqual(
      expect.objectContaining({ id: "__proto__" }),
    );
    expect(store.contacts.valid.messengerIds).toEqual([
      { channel: "telegram", id: "123" },
      { channel: "signal", id: "456" },
    ]);
    expect(({} as { polluted?: unknown }).polluted).toBeUndefined();
  });

  it("falls back to non-conflicting legacy agent files", async () => {
    const legacyContacts = [
      {
        agentId: "main",
        contact: {
          id: "alice",
          name: "Alice",
          messengerIds: [{ channel: "telegram", id: "123" }],
          createdAt: 1,
          updatedAt: 1,
        },
      },
      {
        agentId: "worker",
        contact: {
          id: "bob",
          name: "Bob",
          messengerIds: [{ channel: "discord", id: "abc" }],
          createdAt: 2,
          updatedAt: 2,
        },
      },
    ];
    for (const { agentId, contact } of legacyContacts) {
      const legacyDir = path.join(stateDir, "agents", agentId, "agent");
      fs.mkdirSync(legacyDir, { recursive: true });
      fs.writeFileSync(
        path.join(legacyDir, CONTACT_STORE_FILENAME),
        JSON.stringify({ version: CONTACT_STORE_VERSION, contacts: { [contact.id]: contact } }),
      );
    }

    const fallback = loadContactStore(stateDir);
    expect(Object.keys(fallback.contacts).toSorted()).toEqual(["alice", "bob"]);
    expect(fs.existsSync(path.join(stateDir, CONTACT_STORE_FILENAME))).toBe(false);

    await updateContactStoreWithLock({ stateDir, updater: () => true });
    expect(fs.existsSync(path.join(stateDir, CONTACT_STORE_FILENAME))).toBe(true);
    expect(Object.keys(loadContactStore(stateDir).contacts).toSorted()).toEqual(["alice", "bob"]);
  });

  it("excludes every contact involved in a conflicting legacy id", async () => {
    const contacts = [
      ["main", "Alice"],
      ["worker", "Bob"],
    ] as const;
    for (const [agentId, name] of contacts) {
      const legacyDir = path.join(stateDir, "agents", agentId, "agent");
      fs.mkdirSync(legacyDir, { recursive: true });
      const contact = {
        id: "shared",
        name,
        messengerIds: [{ channel: "telegram", id: agentId }],
        createdAt: 1,
        updatedAt: 1,
      };
      fs.writeFileSync(
        path.join(legacyDir, CONTACT_STORE_FILENAME),
        JSON.stringify({ version: CONTACT_STORE_VERSION, contacts: { shared: contact } }),
      );
    }

    expect(loadContactStore(stateDir).contacts).toEqual({});
    await updateContactStoreWithLock({ stateDir, updater: () => true });
    expect(loadContactStore(stateDir).contacts).toEqual({});
    expect(
      fs.existsSync(path.join(stateDir, "agents", "main", "agent", CONTACT_STORE_FILENAME)),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(stateDir, "agents", "worker", "agent", CONTACT_STORE_FILENAME)),
    ).toBe(true);
  });

  it("excludes every legacy record involved in a case-insensitive id conflict", () => {
    const contacts = [
      ["main", "Alice"],
      ["worker", "alice"],
    ] as const;
    for (const [agentId, id] of contacts) {
      const legacyDir = path.join(stateDir, "agents", agentId, "agent");
      fs.mkdirSync(legacyDir, { recursive: true });
      const contact = {
        id,
        name: id,
        messengerIds: [{ channel: "telegram", id: agentId }],
        createdAt: 1,
        updatedAt: 1,
      };
      fs.writeFileSync(
        path.join(legacyDir, CONTACT_STORE_FILENAME),
        JSON.stringify({ version: CONTACT_STORE_VERSION, contacts: { [id]: contact } }),
      );
    }

    expect(loadContactStore(stateDir).contacts).toEqual({});
  });

  it("excludes every contact involved in a conflicting messenger identity", () => {
    const contacts = [
      ["alice", "Alice"],
      ["bob", "Bob"],
    ] as const;
    for (const [agentId, id] of contacts) {
      const legacyDir = path.join(stateDir, "agents", agentId, "agent");
      fs.mkdirSync(legacyDir, { recursive: true });
      const contact = {
        id,
        name: id.slice(0, 1).toUpperCase() + id.slice(1),
        messengerIds: [{ channel: "telegram", id: "shared" }],
        createdAt: 1,
        updatedAt: 1,
      };
      fs.writeFileSync(
        path.join(legacyDir, CONTACT_STORE_FILENAME),
        JSON.stringify({ version: CONTACT_STORE_VERSION, contacts: { [contact.id]: contact } }),
      );
    }

    expect(loadContactStore(stateDir).contacts).toEqual({});
    for (const agentId of ["alice", "bob"]) {
      expect(
        fs.existsSync(path.join(stateDir, "agents", agentId, "agent", CONTACT_STORE_FILENAME)),
      ).toBe(true);
    }
  });

  it("filters malformed legacy records and messenger identities", () => {
    const legacyDir = path.join(stateDir, "agents", "main", "agent");
    fs.mkdirSync(legacyDir, { recursive: true });
    fs.writeFileSync(
      path.join(legacyDir, CONTACT_STORE_FILENAME),
      JSON.stringify({
        version: CONTACT_STORE_VERSION,
        contacts: {
          valid: {
            id: "valid",
            name: "Valid",
            messengerIds: [
              { channel: "telegram", id: "123" },
              null,
              { channel: "discord", id: 123 },
              { channel: "", id: "missing-channel" },
              { channel: "signal", id: "456" },
            ],
            createdAt: 1,
            updatedAt: 1,
          },
          nullRecord: null,
          badId: {
            id: 42,
            name: "Bad id",
            messengerIds: [{ channel: "telegram", id: "bad-id" }],
            createdAt: 1,
            updatedAt: 1,
          },
          badName: {
            id: "bad-name",
            name: null,
            messengerIds: [{ channel: "telegram", id: "bad-name" }],
            createdAt: 1,
            updatedAt: 1,
          },
          badMessengers: {
            id: "bad-messengers",
            name: "Bad messengers",
            messengerIds: "not-an-array",
            createdAt: 1,
            updatedAt: 1,
          },
          badTimestamps: {
            id: "bad-timestamps",
            name: "Bad timestamps",
            messengerIds: [{ channel: "telegram", id: "bad-timestamps" }],
            createdAt: "now",
            updatedAt: 1,
          },
        },
      }),
    );

    const store = loadContactStore(stateDir);
    expect(Object.keys(store.contacts)).toEqual(["valid"]);
    expect(store.contacts.valid.messengerIds).toEqual([
      { channel: "telegram", id: "123" },
      { channel: "signal", id: "456" },
    ]);
  });

  it("includes injected custom agent dirs in fallback and migration", async () => {
    const customAgentDir = path.join(stateDir, "custom-agent");
    const contact = {
      id: "custom",
      name: "Custom",
      messengerIds: [{ channel: "telegram", id: "custom-1" }],
      createdAt: 1,
      updatedAt: 1,
    };
    fs.mkdirSync(customAgentDir, { recursive: true });
    fs.writeFileSync(
      path.join(customAgentDir, CONTACT_STORE_FILENAME),
      JSON.stringify({ version: CONTACT_STORE_VERSION, contacts: { custom: contact } }),
    );

    expect(loadContactStore(stateDir, { legacyAgentDirs: [customAgentDir] }).contacts).toEqual({
      custom: contact,
    });

    await updateContactStoreWithLock({
      stateDir,
      legacyAgentDirs: [customAgentDir],
      updater: () => true,
    });
    expect(loadContactStore(stateDir).contacts).toEqual({ custom: contact });
    expect(fs.existsSync(path.join(customAgentDir, CONTACT_STORE_FILENAME))).toBe(true);
  });

  it("slugifies names into filesystem-safe ids", () => {
    expect(slugifyContactId("John Doe")).toBe("john-doe");
    expect(slugifyContactId("  ")).toMatch(/^contact-/);
  });
});
