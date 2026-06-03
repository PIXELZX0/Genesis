import { describe, expect, it } from "vitest";
import { isTrustedMcpOAuthMessage } from "./mcp-oauth-trust.ts";

const GATEWAY_ORIGIN = "http://127.0.0.1:18789";
const popup = { id: "popup" };

describe("isTrustedMcpOAuthMessage", () => {
  it("accepts a same-origin message tagged by the callback page", () => {
    expect(
      isTrustedMcpOAuthMessage({
        origin: GATEWAY_ORIGIN,
        source: popup,
        expectedOrigin: GATEWAY_ORIGIN,
        popup,
        dataSource: "genesis-mcp-oauth",
      }),
    ).toBe(true);
  });

  it("rejects messages without our source tag", () => {
    expect(
      isTrustedMcpOAuthMessage({
        origin: GATEWAY_ORIGIN,
        source: popup,
        expectedOrigin: GATEWAY_ORIGIN,
        popup,
        dataSource: "evil",
      }),
    ).toBe(false);
  });

  it("rejects messages from a different origin", () => {
    expect(
      isTrustedMcpOAuthMessage({
        origin: "https://attacker.example",
        source: popup,
        expectedOrigin: GATEWAY_ORIGIN,
        popup,
        dataSource: "genesis-mcp-oauth",
      }),
    ).toBe(false);
  });

  it("accepts an opaque origin only when the message came from our popup", () => {
    expect(
      isTrustedMcpOAuthMessage({
        origin: "null",
        source: popup,
        expectedOrigin: GATEWAY_ORIGIN,
        popup,
        dataSource: "genesis-mcp-oauth",
      }),
    ).toBe(true);
    expect(
      isTrustedMcpOAuthMessage({
        origin: "",
        source: popup,
        expectedOrigin: GATEWAY_ORIGIN,
        popup,
        dataSource: "genesis-mcp-oauth",
      }),
    ).toBe(true);
  });

  it("rejects an opaque origin when the source is not our popup", () => {
    expect(
      isTrustedMcpOAuthMessage({
        origin: "null",
        source: { id: "other" },
        expectedOrigin: GATEWAY_ORIGIN,
        popup,
        dataSource: "genesis-mcp-oauth",
      }),
    ).toBe(false);
    expect(
      isTrustedMcpOAuthMessage({
        origin: "null",
        source: popup,
        expectedOrigin: GATEWAY_ORIGIN,
        popup: null,
        dataSource: "genesis-mcp-oauth",
      }),
    ).toBe(false);
  });

  it("does not treat an empty expectedOrigin as a wildcard match", () => {
    expect(
      isTrustedMcpOAuthMessage({
        origin: "",
        source: { id: "other" },
        expectedOrigin: "",
        popup,
        dataSource: "genesis-mcp-oauth",
      }),
    ).toBe(false);
  });
});
