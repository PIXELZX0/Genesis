import { describe, expect, it } from "vitest";
import { buildAgentPeerSessionKey } from "./session-key.js";

const identityLinks = { alice: ["telegram:123", "discord:abc"] };

describe("buildAgentPeerSessionKey with contact unification", () => {
  it("collapses linked direct peers to one per-peer session at dmScope main", () => {
    const fromTelegram = buildAgentPeerSessionKey({
      agentId: "main",
      channel: "telegram",
      peerKind: "direct",
      peerId: "123",
      dmScope: "main",
      identityLinks,
      unifyContacts: true,
    });
    const fromDiscord = buildAgentPeerSessionKey({
      agentId: "main",
      channel: "discord",
      peerKind: "direct",
      peerId: "abc",
      dmScope: "main",
      identityLinks,
      unifyContacts: true,
    });
    expect(fromTelegram).toBe("agent:main:direct:alice");
    expect(fromDiscord).toBe("agent:main:direct:alice");
  });

  it("does not merge when unifyContacts is off at dmScope main", () => {
    const key = buildAgentPeerSessionKey({
      agentId: "main",
      channel: "telegram",
      peerKind: "direct",
      peerId: "123",
      dmScope: "main",
      identityLinks,
    });
    expect(key).toBe("agent:main:main");
  });

  it("leaves an unknown direct peer on the default main session", () => {
    const key = buildAgentPeerSessionKey({
      agentId: "main",
      channel: "telegram",
      peerKind: "direct",
      peerId: "999",
      dmScope: "main",
      identityLinks,
      unifyContacts: true,
    });
    expect(key).toBe("agent:main:main");
  });

  it("does not merge group/channel sessions", () => {
    const group = buildAgentPeerSessionKey({
      agentId: "main",
      channel: "telegram",
      peerKind: "group",
      peerId: "123",
      dmScope: "main",
      identityLinks,
      unifyContacts: true,
    });
    expect(group).toBe("agent:main:telegram:group:123");
  });
});
