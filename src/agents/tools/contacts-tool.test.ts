import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GenesisConfig } from "../../config/types.genesis.js";
import { clearContactStoreCacheForTest } from "../../contacts/store.js";
import { createContactsTool } from "./contacts-tool.js";

const enabledConfig = { session: { contacts: { enabled: true } } } as unknown as GenesisConfig;
const disabledConfig = { session: { contacts: { enabled: false } } } as unknown as GenesisConfig;

let stateDir: string;

beforeEach(() => {
  stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "genesis-contacts-tool-"));
  clearContactStoreCacheForTest();
});

afterEach(() => {
  fs.rmSync(stateDir, { recursive: true, force: true });
  vi.unstubAllEnvs();
  clearContactStoreCacheForTest();
});

function parse(result: {
  content: Array<{ type: string; text?: string }>;
}): Record<string, unknown> {
  const text = result.content.find((c) => c.type === "text")?.text ?? "{}";
  return JSON.parse(text) as Record<string, unknown>;
}

describe("contacts tool", () => {
  it("returns null only when contacts are explicitly disabled", () => {
    expect(createContactsTool({ stateDir, config: disabledConfig })).toBeNull();
  });

  it("is enabled when the setting is omitted and no agent dir is provided", () => {
    expect(createContactsTool({ stateDir, config: {} as GenesisConfig })).not.toBeNull();
  });

  it("reads legacy contacts from configured custom agent dirs", async () => {
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
      path.join(customAgentDir, "contacts.json"),
      JSON.stringify({ version: 1, contacts: { custom: contact } }),
    );

    const tool = createContactsTool({
      stateDir,
      config: {
        agents: { list: [{ id: "worker", agentDir: customAgentDir }] },
      } as GenesisConfig,
    });
    if (!tool) {
      throw new Error("tool not created");
    }

    const listed = parse(await tool.execute("1", { action: "list" }));
    expect(listed.contacts).toEqual([
      { id: "custom", name: "Custom", messengerIds: contact.messengerIds },
    ]);
  });

  it("reads legacy contacts from runtime and current agent dirs in production", async () => {
    vi.stubEnv("GENESIS_STATE_DIR", stateDir);
    const envAgentDir = path.join(stateDir, "env-agent");
    const piAgentDir = path.join(stateDir, "pi-agent");
    const currentAgentDir = path.join(stateDir, "current-agent");
    const contacts = [
      ["env", envAgentDir],
      ["pi", piAgentDir],
      ["current", currentAgentDir],
    ] as const;
    for (const [id, agentDir] of contacts) {
      const contact = {
        id,
        name: id,
        messengerIds: [{ channel: "telegram", id }],
        createdAt: 1,
        updatedAt: 1,
      };
      fs.mkdirSync(agentDir, { recursive: true });
      fs.writeFileSync(
        path.join(agentDir, "contacts.json"),
        JSON.stringify({ version: 1, contacts: { [id]: contact } }),
      );
    }
    vi.stubEnv("GENESIS_AGENT_DIR", envAgentDir);
    vi.stubEnv("PI_CODING_AGENT_DIR", piAgentDir);

    const tool = createContactsTool({ config: enabledConfig, agentDir: currentAgentDir });
    if (!tool) {
      throw new Error("tool not created");
    }

    const listed = parse(await tool.execute("1", { action: "list" }));
    expect(
      (listed.contacts as Array<{ id: string }>).map((contact) => contact.id).toSorted(),
    ).toEqual(["current", "env", "pi"]);
  });

  it("does not read env runtime agent dirs when stateDir is explicit", async () => {
    const envAgentDir = path.join(stateDir, "env-agent");
    const contact = {
      id: "external",
      name: "External",
      messengerIds: [{ channel: "telegram", id: "external" }],
      createdAt: 1,
      updatedAt: 1,
    };
    fs.mkdirSync(envAgentDir, { recursive: true });
    fs.writeFileSync(
      path.join(envAgentDir, "contacts.json"),
      JSON.stringify({ version: 1, contacts: { external: contact } }),
    );
    vi.stubEnv("GENESIS_AGENT_DIR", envAgentDir);

    const tool = createContactsTool({ stateDir, config: enabledConfig });
    if (!tool) {
      throw new Error("tool not created");
    }

    const listed = parse(await tool.execute("1", { action: "list" }));
    expect(listed.contacts).toEqual([]);
  });

  it("does not require a state or agent dir to construct the production tool", () => {
    expect(createContactsTool({ config: enabledConfig })).not.toBeNull();
  });

  it("is marked owner-only", () => {
    const tool = createContactsTool({ stateDir, config: enabledConfig });
    expect(tool?.ownerOnly).toBe(true);
  });

  it("saves, gets, links, lists and deletes a contact", async () => {
    const tool = createContactsTool({ stateDir, config: enabledConfig });
    if (!tool) {
      throw new Error("tool not created");
    }

    const saved = parse(
      await tool.execute("1", {
        action: "save",
        name: "Alice",
        age: 30,
        messengers: [{ channel: "telegram", id: "123" }],
      }),
    );
    expect(saved.saved).toBe(true);
    const contactId = (saved.contact as { id: string }).id;

    const got = parse(
      await tool.execute("2", { action: "get", channel: "telegram", messenger_id: "123" }),
    );
    expect((got.contact as { name: string }).name).toBe("Alice");

    const linked = parse(
      await tool.execute("3", {
        action: "link",
        id: contactId,
        channel: "discord",
        messenger_id: "abc",
      }),
    );
    expect(linked.linked).toBe(true);
    expect((linked.contact as { messengerIds: unknown[] }).messengerIds).toHaveLength(2);

    const bob = parse(
      await tool.execute("3b", {
        action: "save",
        name: "Bob",
        messengers: [{ channel: "signal", id: "bob-1" }],
      }),
    );
    expect(bob.saved).toBe(true);
    const bobId = (bob.contact as { id: string }).id;
    const conflictingLink = parse(
      await tool.execute("3c", {
        action: "link",
        id: contactId,
        channel: "signal",
        messenger_id: "bob-1",
      }),
    );
    expect(conflictingLink.linked).toBe(false);
    expect((conflictingLink.contact as { messengerIds: unknown[] }).messengerIds).toHaveLength(2);

    const listed = parse(await tool.execute("4", { action: "list" }));
    expect((listed.contacts as unknown[]).length).toBe(2);

    const deleted = parse(await tool.execute("5", { action: "delete", id: contactId }));
    expect(deleted.deleted).toBe(true);
    const deletedBob = parse(await tool.execute("5b", { action: "delete", id: bobId }));
    expect(deletedBob.deleted).toBe(true);
    const listedAfter = parse(await tool.execute("6", { action: "list" }));
    expect((listedAfter.contacts as unknown[]).length).toBe(0);
  });

  it("returns the upserted contact for name-only, case-insensitive, and messenger matches", async () => {
    const tool = createContactsTool({ stateDir, config: enabledConfig });
    if (!tool) {
      throw new Error("tool not created");
    }

    const nameOnly = parse(await tool.execute("name-only", { action: "save", name: "Alice" }));
    const alice = nameOnly.contact as { id: string; name: string };
    expect(alice).toEqual(expect.objectContaining({ id: "alice", name: "Alice" }));

    const caseInsensitive = parse(
      await tool.execute("case-insensitive", {
        action: "save",
        id: alice.id.toUpperCase(),
        name: "Updated Alice",
      }),
    );
    expect(caseInsensitive.contact).toEqual(
      expect.objectContaining({ id: alice.id, name: "Updated Alice" }),
    );

    const messengerCreated = parse(
      await tool.execute("messenger-created", {
        action: "save",
        name: "Bob",
        messengers: [{ channel: "telegram", id: "bob-1" }],
      }),
    );
    const messengerMatched = parse(
      await tool.execute("messenger-matched", {
        action: "save",
        name: "Updated Bob",
        messengers: [{ channel: "TELEGRAM", id: "BOB-1" }],
      }),
    );
    expect(messengerMatched.contact).toEqual(
      expect.objectContaining({
        id: (messengerCreated.contact as { id: string }).id,
        name: "Updated Bob",
      }),
    );
  });

  it("throws when getting a missing contact", async () => {
    const tool = createContactsTool({ stateDir, config: enabledConfig });
    if (!tool) {
      throw new Error("tool not created");
    }
    await expect(tool.execute("1", { action: "get", id: "nope" })).rejects.toThrow();
  });

  it("returns deleted:false when deleting a missing contact", async () => {
    const tool = createContactsTool({ stateDir, config: enabledConfig });
    if (!tool) {
      throw new Error("tool not created");
    }

    const result = parse(await tool.execute("delete-missing", { action: "delete", id: "nope" }));
    expect(result).toEqual({ deleted: false, id: "nope" });
  });

  it("throws when the contact store cannot be updated for delete", async () => {
    fs.rmSync(stateDir, { recursive: true, force: true });
    fs.writeFileSync(stateDir, "not a directory");

    const tool = createContactsTool({ stateDir, config: enabledConfig });
    if (!tool) {
      throw new Error("tool not created");
    }

    await expect(tool.execute("delete-failed", { action: "delete", id: "nope" })).rejects.toThrow(
      "failed to delete contact",
    );
  });
});
