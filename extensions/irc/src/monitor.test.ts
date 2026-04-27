import { describe, expect, it } from "vitest";
import { resolveIrcInboundTarget } from "./monitor.js";

describe("irc monitor inbound target", () => {
  it("keeps channel target for group messages", () => {
    expect(
      resolveIrcInboundTarget({
        target: "#genesis",
        senderNick: "alice",
      }),
    ).toEqual({
      isGroup: true,
      target: "#genesis",
      rawTarget: "#genesis",
    });
  });

  it("maps DM target to sender nick and preserves raw target", () => {
    expect(
      resolveIrcInboundTarget({
        target: "genesis-bot",
        senderNick: "alice",
      }),
    ).toEqual({
      isGroup: false,
      target: "alice",
      rawTarget: "genesis-bot",
    });
  });

  it("falls back to raw target when sender nick is empty", () => {
    expect(
      resolveIrcInboundTarget({
        target: "genesis-bot",
        senderNick: " ",
      }),
    ).toEqual({
      isGroup: false,
      target: "genesis-bot",
      rawTarget: "genesis-bot",
    });
  });
});
