import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GenesisConfig } from "../../config/types.genesis.js";
import {
  findContactByMessengerId,
  loadContactStore,
  saveContactStore,
} from "../../contacts/store.js";
import type { ContactStore } from "../../contacts/types.js";
import type { MsgContext } from "../templating.js";
import { applyContactContext } from "./contact-context.js";

let stateDir: string | undefined;

afterEach(() => {
  if (stateDir) {
    fs.rmSync(stateDir, { recursive: true, force: true });
    stateDir = undefined;
  }
  vi.unstubAllEnvs();
});

function createStore(): ContactStore {
  return {
    version: 1,
    contacts: {
      alice: {
        id: "alice",
        name: "Alice",
        traits: ["patient"],
        messengerIds: [{ channel: "telegram", id: "123" }],
        createdAt: 0,
        updatedAt: 0,
      },
    },
  };
}

function createContext(overrides: Partial<MsgContext> = {}): MsgContext {
  return {
    ChatType: "direct",
    Provider: "telegram",
    SenderId: "123",
    ...overrides,
  };
}

describe("applyContactContext", () => {
  it("reads the shared state-root contact without an agent dir", async () => {
    stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "genesis-contact-context-"));
    saveContactStore(createStore(), stateDir);
    const sessionCtx = createContext();

    await applyContactContext({
      cfg: {} as GenesisConfig,
      stateDir,
      sessionCtx,
    });

    expect(sessionCtx.ContactId).toBe("alice");
    expect(sessionCtx.ContactName).toBe("Alice");
    expect(sessionCtx.ContactProfile).toEqual({ traits: ["patient"] });
  });

  it("auto-captures unknown direct senders in the shared store by default", async () => {
    stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "genesis-contact-context-"));
    const sessionCtx = createContext({
      SenderId: "456",
      SenderName: "Bob",
      SenderUsername: "bob_telegram",
    });

    await applyContactContext({
      cfg: {} as GenesisConfig,
      stateDir,
      sessionCtx,
    });

    expect(sessionCtx.ContactName).toBe("Bob");
    expect(findContactByMessengerId(loadContactStore(stateDir), "telegram", "456")?.name).toBe(
      "Bob",
    );
  });

  it("does not persist or attach direct WebChat senders", async () => {
    stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "genesis-contact-context-"));
    const sessionCtx = createContext({
      Provider: "webchat",
      SenderId: "browser-client",
      SenderName: "Browser Client",
    });

    await applyContactContext({
      cfg: {} as GenesisConfig,
      stateDir,
      sessionCtx,
    });

    expect(sessionCtx.ContactId).toBeUndefined();
    expect(sessionCtx.ContactName).toBeUndefined();
    expect(loadContactStore(stateDir).contacts).toEqual({});
    expect(fs.existsSync(path.join(stateDir, "contacts.json"))).toBe(false);
  });

  it("reads legacy contacts from the current runtime agent dir", async () => {
    stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "genesis-contact-context-"));
    vi.stubEnv("GENESIS_STATE_DIR", stateDir);
    const agentDir = path.join(stateDir, "runtime-agent");
    const contact = {
      id: "legacy-alice",
      name: "Legacy Alice",
      messengerIds: [{ channel: "telegram", id: "123" }],
      createdAt: 1,
      updatedAt: 1,
    };
    fs.mkdirSync(agentDir, { recursive: true });
    fs.writeFileSync(
      path.join(agentDir, "contacts.json"),
      JSON.stringify({ version: 1, contacts: { [contact.id]: contact } }),
    );

    const sessionCtx = createContext();
    await applyContactContext({ cfg: {} as GenesisConfig, agentDir, sessionCtx });

    expect(sessionCtx.ContactId).toBe(contact.id);
    expect(sessionCtx.ContactName).toBe(contact.name);
  });

  it("filters malformed legacy records before auto-capture", async () => {
    stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "genesis-contact-context-"));
    const legacyDir = path.join(stateDir, "agents", "main", "agent");
    fs.mkdirSync(legacyDir, { recursive: true });
    fs.writeFileSync(
      path.join(legacyDir, "contacts.json"),
      JSON.stringify({
        version: 1,
        contacts: {
          broken: null,
          valid: {
            id: "valid",
            name: "Valid",
            messengerIds: [{ channel: "telegram", id: "123" }],
            createdAt: 1,
            updatedAt: 1,
          },
        },
      }),
    );

    const sessionCtx = createContext({ SenderId: "456", SenderName: "Captured" });
    await expect(
      applyContactContext({ cfg: {} as GenesisConfig, stateDir, sessionCtx }),
    ).resolves.toBeUndefined();

    expect(sessionCtx.ContactName).toBe("Captured");
    expect(findContactByMessengerId(loadContactStore(stateDir), "telegram", "456")?.name).toBe(
      "Captured",
    );
  });

  it("does nothing when contacts are explicitly disabled", async () => {
    stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "genesis-contact-context-"));
    const sessionCtx = createContext({ SenderId: "789" });

    await applyContactContext({
      cfg: { session: { contacts: { enabled: false } } } as GenesisConfig,
      stateDir,
      sessionCtx,
    });

    expect(sessionCtx.ContactId).toBeUndefined();
    expect(loadContactStore(stateDir).contacts).toEqual({});
  });
});
