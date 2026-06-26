import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { GenesisConfig } from "../../config/types.genesis.js";
import { clearContactStoreCacheForTest } from "../../contacts/store.js";
import { createContactsTool } from "./contacts-tool.js";

const enabledConfig = { session: { contacts: { enabled: true } } } as unknown as GenesisConfig;

let agentDir: string;

beforeEach(() => {
  agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "genesis-contacts-tool-"));
  clearContactStoreCacheForTest();
});

afterEach(() => {
  fs.rmSync(agentDir, { recursive: true, force: true });
  clearContactStoreCacheForTest();
});

function parse(result: {
  content: Array<{ type: string; text?: string }>;
}): Record<string, unknown> {
  const text = result.content.find((c) => c.type === "text")?.text ?? "{}";
  return JSON.parse(text) as Record<string, unknown>;
}

describe("contacts tool", () => {
  it("returns null when contacts are disabled", () => {
    expect(createContactsTool({ agentDir, config: {} as GenesisConfig })).toBeNull();
  });

  it("returns null without an agent dir", () => {
    expect(createContactsTool({ config: enabledConfig })).toBeNull();
  });

  it("is marked owner-only", () => {
    const tool = createContactsTool({ agentDir, config: enabledConfig });
    expect(tool?.ownerOnly).toBe(true);
  });

  it("saves, gets, links, lists and deletes a contact", async () => {
    const tool = createContactsTool({ agentDir, config: enabledConfig });
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

    const listed = parse(await tool.execute("4", { action: "list" }));
    expect((listed.contacts as unknown[]).length).toBe(1);

    const deleted = parse(await tool.execute("5", { action: "delete", id: contactId }));
    expect(deleted.deleted).toBe(true);
    const listedAfter = parse(await tool.execute("6", { action: "list" }));
    expect((listedAfter.contacts as unknown[]).length).toBe(0);
  });

  it("throws when getting a missing contact", async () => {
    const tool = createContactsTool({ agentDir, config: enabledConfig });
    if (!tool) {
      throw new Error("tool not created");
    }
    await expect(tool.execute("1", { action: "get", id: "nope" })).rejects.toThrow();
  });
});
