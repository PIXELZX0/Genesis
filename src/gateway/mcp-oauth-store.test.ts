import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  consumeMcpOAuthState,
  createMcpOAuthState,
  deleteMcpOAuthToken,
  generatePkcePair,
  getMcpOAuthToken,
  listMcpOAuthTokens,
  pruneExpiredMcpOAuthStates,
  setMcpOAuthToken,
  type McpOAuthTokenRecord,
} from "./mcp-oauth-store.js";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-oauth-store-"));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function storeFile(): string {
  return path.join(dir, "mcp-oauth.json");
}

const sampleToken: McpOAuthTokenRecord = {
  accessToken: "secret-access-token-value",
  refreshToken: "secret-refresh-token-value",
  expiresAtMs: Date.now() + 3_600_000,
  providerName: "Notion",
  scopes: ["read", "write"],
  tokenUrl: "https://example.test/token",
};

describe("mcp-oauth-store", () => {
  it("round-trips a token through set/get", () => {
    setMcpOAuthToken("srv", sampleToken, dir);
    expect(getMcpOAuthToken("srv", dir)).toEqual(sampleToken);
    expect(listMcpOAuthTokens(dir)).toEqual({ srv: sampleToken });
  });

  it("encrypts tokens at rest (no plaintext secret on disk)", () => {
    setMcpOAuthToken("srv", sampleToken, dir);
    const raw = fs.readFileSync(storeFile(), "utf8");
    const parsed = JSON.parse(raw) as { enc?: string; ciphertext?: string };
    expect(parsed.enc).toBe("aes-256-gcm");
    expect(typeof parsed.ciphertext).toBe("string");
    expect(raw).not.toContain("secret-access-token-value");
    expect(raw).not.toContain("secret-refresh-token-value");
  });

  it("writes the token store and key file with 0600 permissions", () => {
    setMcpOAuthToken("srv", sampleToken, dir);
    const tokenMode = fs.statSync(storeFile()).mode & 0o777;
    const keyMode = fs.statSync(path.join(dir, "mcp-oauth.key")).mode & 0o777;
    expect(tokenMode).toBe(0o600);
    expect(keyMode).toBe(0o600);
  });

  it("returns null/empty for a missing store", () => {
    expect(getMcpOAuthToken("nope", dir)).toBeNull();
    expect(listMcpOAuthTokens(dir)).toEqual({});
  });

  it("treats a corrupt store as empty without deleting it", () => {
    fs.writeFileSync(storeFile(), "this is not json", { mode: 0o600 });
    expect(getMcpOAuthToken("srv", dir)).toBeNull();
    expect(fs.existsSync(storeFile())).toBe(true);
  });

  it("reads a legacy v1 plaintext store and re-encrypts on next write", () => {
    fs.writeFileSync(
      storeFile(),
      JSON.stringify({ tokens: { legacy: { accessToken: "old" } }, states: {} }),
      { mode: 0o600 },
    );
    expect(getMcpOAuthToken("legacy", dir)?.accessToken).toBe("old");

    setMcpOAuthToken("fresh", sampleToken, dir);
    const parsed = JSON.parse(fs.readFileSync(storeFile(), "utf8")) as { enc?: string };
    expect(parsed.enc).toBe("aes-256-gcm");
    // legacy token survives the migration
    expect(getMcpOAuthToken("legacy", dir)?.accessToken).toBe("old");
  });

  it("treats tokens as unreadable (not deleted) when the key changes", () => {
    setMcpOAuthToken("srv", sampleToken, dir);
    // Simulate a rotated/corrupted key: overwrite with a different 32-byte key.
    fs.writeFileSync(path.join(dir, "mcp-oauth.key"), crypto.randomBytes(32).toString("base64"), {
      mode: 0o600,
    });
    expect(getMcpOAuthToken("srv", dir)).toBeNull();
    expect(fs.existsSync(storeFile())).toBe(true);
  });

  it("creates, consumes, and single-uses OAuth state (with PKCE verifier)", () => {
    const state = createMcpOAuthState({ name: "srv", codeVerifier: "v123", scopes: ["a"] }, dir);
    expect(state).toMatch(/^[A-Za-z0-9_-]+$/);
    const record = consumeMcpOAuthState(state, dir);
    expect(record?.name).toBe("srv");
    expect(record?.codeVerifier).toBe("v123");
    // single use
    expect(consumeMcpOAuthState(state, dir)).toBeNull();
  });

  it("prunes expired pending states only", () => {
    const fresh = createMcpOAuthState({ name: "fresh" }, dir);
    createMcpOAuthState({ name: "stale" }, dir);
    // Fresh states survive a normal TTL.
    expect(pruneExpiredMcpOAuthStates(10 * 60 * 1000, dir)).toBe(0);
    // A negative TTL pushes the cutoff into the future, expiring everything.
    expect(pruneExpiredMcpOAuthStates(-1, dir)).toBe(2);
    expect(consumeMcpOAuthState(fresh, dir)).toBeNull();
  });

  it("deletes a token and its pending states", () => {
    setMcpOAuthToken("srv", sampleToken, dir);
    const state = createMcpOAuthState({ name: "srv" }, dir);
    deleteMcpOAuthToken("srv", dir);
    expect(getMcpOAuthToken("srv", dir)).toBeNull();
    expect(consumeMcpOAuthState(state, dir)).toBeNull();
  });

  it("generates a valid PKCE S256 pair", () => {
    const { codeVerifier, codeChallenge } = generatePkcePair();
    expect(codeVerifier).toMatch(/^[A-Za-z0-9_-]+$/);
    const expected = crypto.createHash("sha256").update(codeVerifier).digest("base64url");
    expect(codeChallenge).toBe(expected);
  });
});
