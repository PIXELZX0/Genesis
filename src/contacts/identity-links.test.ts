import { describe, expect, it } from "vitest";
import { buildContactIdentityLinks } from "./identity-links.js";
import type { ContactStore } from "./types.js";

function makeStore(): ContactStore {
  return {
    version: 1,
    contacts: {
      alice: {
        id: "alice",
        name: "Alice",
        messengerIds: [
          { channel: "telegram", id: "123" },
          { channel: "discord", id: "abc" },
        ],
        createdAt: 0,
        updatedAt: 0,
      },
    },
  };
}

describe("buildContactIdentityLinks", () => {
  it("maps a contact id to its channel:id strings", () => {
    expect(buildContactIdentityLinks(makeStore())).toEqual({
      alice: ["telegram:123", "discord:abc"],
    });
  });

  it("returns undefined for an empty store", () => {
    expect(buildContactIdentityLinks({ version: 1, contacts: {} })).toBeUndefined();
  });

  it("skips contacts with no messenger ids", () => {
    const store: ContactStore = {
      version: 1,
      contacts: {
        bob: { id: "bob", name: "Bob", messengerIds: [], createdAt: 0, updatedAt: 0 },
      },
    };
    expect(buildContactIdentityLinks(store)).toBeUndefined();
  });
});
