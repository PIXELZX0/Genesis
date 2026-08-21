import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GenesisConfig } from "../config/types.genesis.js";
import {
  resolveEffectiveIdentityLinks,
  isContactSessionUnifyEnabled,
} from "../routing/identity-links.runtime.js";
import { buildContactIdentityLinks, getContactIdentityLinks } from "./identity-links.js";
import { saveContactStore } from "./store.js";
import type { ContactStore } from "./types.js";

let stateDir: string | undefined;

afterEach(() => {
  if (stateDir) {
    fs.rmSync(stateDir, { recursive: true, force: true });
    stateDir = undefined;
  }
  vi.unstubAllEnvs();
});

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

  it("preserves unsafe contact ids without changing the links map prototype", () => {
    const contacts: ContactStore["contacts"] = Object.create(null) as ContactStore["contacts"];
    Object.defineProperty(contacts, "__proto__", {
      configurable: true,
      enumerable: true,
      value: {
        id: "__proto__",
        name: "Prototype Contact",
        messengerIds: [{ channel: "telegram", id: "123" }],
        createdAt: 0,
        updatedAt: 0,
      },
      writable: true,
    });

    const links = buildContactIdentityLinks({ version: 1, contacts });
    if (!links) {
      throw new Error("expected contact links");
    }
    expect(Object.keys(links)).toEqual(["__proto__"]);
    expect(Object.getOwnPropertyDescriptor(links, "__proto__")?.value).toEqual(["telegram:123"]);
    expect(Object.getPrototypeOf(links)).toBeNull();
    expect(({} as { telegram?: unknown }).telegram).toBeUndefined();
  });

  it("loads identity links from the shared state root", () => {
    stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "genesis-contacts-links-"));
    saveContactStore(makeStore(), stateDir);

    expect(getContactIdentityLinks(stateDir)).toEqual({
      alice: ["telegram:123", "discord:abc"],
    });
    expect(
      resolveEffectiveIdentityLinks({
        cfg: {} as GenesisConfig,
        agentId: "worker",
        stateDir,
        includeContactLinks: true,
      }),
    ).toEqual({ alice: ["telegram:123", "discord:abc"] });
  });

  it("keeps configured links without scanning contacts when contact links are excluded", () => {
    stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "genesis-contacts-links-"));
    saveContactStore(makeStore(), stateDir);

    expect(
      resolveEffectiveIdentityLinks({
        cfg: {
          session: { identityLinks: { configured: ["slack:1"] } },
        } as GenesisConfig,
        agentId: "main",
        stateDir,
        includeContactLinks: false,
      }),
    ).toEqual({ configured: ["slack:1"] });
  });

  it("gives configured links precedence over case-insensitive contact keys", () => {
    stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "genesis-contacts-links-"));
    saveContactStore(
      {
        version: 1,
        contacts: {
          Alice: {
            id: "Alice",
            name: "Alice",
            messengerIds: [{ channel: "telegram", id: "123" }],
            createdAt: 0,
            updatedAt: 0,
          },
          bob: {
            id: "bob",
            name: "Bob",
            messengerIds: [{ channel: "telegram", id: "456" }],
            createdAt: 0,
            updatedAt: 0,
          },
        },
      },
      stateDir,
    );

    const links = resolveEffectiveIdentityLinks({
      cfg: {
        session: { identityLinks: { alice: ["slack:1"] } },
      } as GenesisConfig,
      agentId: "main",
      stateDir,
      includeContactLinks: true,
    });

    if (!links) {
      throw new Error("expected effective identity links");
    }
    expect(links).toEqual({ bob: ["telegram:456"], alice: ["slack:1"] });
    expect(Object.getPrototypeOf(links)).toBeNull();
  });

  it("safely merges unsafe identity-link keys", () => {
    stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "genesis-contacts-links-"));
    const contacts: ContactStore["contacts"] = Object.create(null) as ContactStore["contacts"];
    Object.defineProperty(contacts, "__proto__", {
      configurable: true,
      enumerable: true,
      value: {
        id: "__proto__",
        name: "Prototype Contact",
        messengerIds: [{ channel: "telegram", id: "123" }],
        createdAt: 0,
        updatedAt: 0,
      },
      writable: true,
    });
    saveContactStore({ version: 1, contacts }, stateDir);

    const configuredLinks: Record<string, string[]> = Object.create(null) as Record<
      string,
      string[]
    >;
    Object.defineProperty(configuredLinks, "__proto__", {
      configurable: true,
      enumerable: true,
      value: ["slack:1"],
      writable: true,
    });

    const links = resolveEffectiveIdentityLinks({
      cfg: { session: { identityLinks: configuredLinks } } as GenesisConfig,
      agentId: "main",
      stateDir,
      includeContactLinks: true,
    });

    if (!links) {
      throw new Error("expected effective identity links");
    }
    expect(Object.getPrototypeOf(links)).toBeNull();
    expect(Object.keys(links)).toEqual(["__proto__"]);
    expect(Object.getOwnPropertyDescriptor(links, "__proto__")?.value).toEqual(["slack:1"]);
    expect(({} as { telegram?: unknown }).telegram).toBeUndefined();
  });

  it("loads runtime legacy contacts and filters malformed records", () => {
    stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "genesis-contacts-links-"));
    const agentDir = path.join(stateDir, "runtime-agent");
    fs.mkdirSync(agentDir, { recursive: true });
    fs.writeFileSync(
      path.join(agentDir, "contacts.json"),
      JSON.stringify({
        version: 1,
        contacts: {
          broken: null,
          valid: {
            id: "valid",
            name: "Valid",
            messengerIds: [
              { channel: "telegram", id: "123" },
              { channel: "discord", id: 456 },
            ],
            createdAt: 1,
            updatedAt: 1,
          },
        },
      }),
    );
    vi.stubEnv("GENESIS_STATE_DIR", stateDir);
    vi.stubEnv("GENESIS_AGENT_DIR", agentDir);

    expect(
      resolveEffectiveIdentityLinks({
        cfg: {} as GenesisConfig,
        agentId: "main",
        includeContactLinks: true,
      }),
    ).toEqual({ valid: ["telegram:123"] });
  });

  it("uses an explicit runtime agent dir without reading env dirs for an explicit state root", () => {
    stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "genesis-contacts-links-"));
    const explicitAgentDir = path.join(stateDir, "explicit-agent");
    const envAgentDir = path.join(stateDir, "env-agent");
    for (const [dir, id] of [
      [explicitAgentDir, "explicit"],
      [envAgentDir, "env"],
    ] as const) {
      fs.mkdirSync(dir, { recursive: true });
      const contact = {
        id,
        name: id,
        messengerIds: [{ channel: "telegram", id }],
        createdAt: 1,
        updatedAt: 1,
      };
      fs.writeFileSync(
        path.join(dir, "contacts.json"),
        JSON.stringify({ version: 1, contacts: { [id]: contact } }),
      );
    }
    vi.stubEnv("GENESIS_AGENT_DIR", envAgentDir);

    expect(
      resolveEffectiveIdentityLinks({
        cfg: {} as GenesisConfig,
        agentId: "main",
        agentDir: explicitAgentDir,
        stateDir,
        includeContactLinks: true,
      }),
    ).toEqual({ explicit: ["telegram:explicit"] });
  });

  it("treats omitted contacts as enabled but explicit false as disabled", () => {
    expect(isContactSessionUnifyEnabled({ session: { contacts: { unifySessions: true } } })).toBe(
      true,
    );
    expect(
      isContactSessionUnifyEnabled({
        session: { contacts: { enabled: false, unifySessions: true } },
      }),
    ).toBe(false);
  });
});
