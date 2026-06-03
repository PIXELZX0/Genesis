import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { STATE_DIR } from "../config/paths.js";

/**
 * Tokens stored per MCP server. Includes a CSRF state map for in-flight
 * authorization requests keyed by `state`.
 */
export type McpOAuthTokenRecord = {
  /** Provider-issued access token used as `Authorization: Bearer`. */
  accessToken: string;
  /** Optional refresh token. */
  refreshToken?: string;
  /** Epoch ms when the access token expires, if known. */
  expiresAtMs?: number;
  /** Provider display name (e.g. "Notion"). */
  providerName?: string;
  /** OAuth scopes granted. */
  scopes?: string[];
};

export type McpOAuthStateRecord = {
  /** Server name being authorized. */
  name: string;
  /** PKCE code verifier, if used. */
  codeVerifier?: string;
  /** Epoch ms when this state was issued. */
  createdAtMs: number;
  /** Scopes that were requested. */
  scopes?: string[];
};

type McpOAuthStore = {
  tokens: Record<string, McpOAuthTokenRecord>;
  states: Record<string, McpOAuthStateRecord>;
};

const MCP_OAUTH_FILENAME = "mcp-oauth.json";

function oauthStorePath(stateDir: string = STATE_DIR): string {
  return path.join(stateDir, MCP_OAUTH_FILENAME);
}

function readStore(filePath: string): McpOAuthStore {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<McpOAuthStore>;
    return {
      tokens: parsed.tokens ?? {},
      states: parsed.states ?? {},
    };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { tokens: {}, states: {} };
    }
    throw err;
  }
}

function writeStore(filePath: string, store: McpOAuthStore): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(store, null, 2), { mode: 0o600 });
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // best-effort; some filesystems do not support chmod
  }
}

export function listMcpOAuthTokens(
  stateDir: string = STATE_DIR,
): Record<string, McpOAuthTokenRecord> {
  return readStore(oauthStorePath(stateDir)).tokens;
}

export function getMcpOAuthToken(
  name: string,
  stateDir: string = STATE_DIR,
): McpOAuthTokenRecord | null {
  const tokens = readStore(oauthStorePath(stateDir)).tokens;
  return tokens[name] ?? null;
}

export function setMcpOAuthToken(
  name: string,
  token: McpOAuthTokenRecord,
  stateDir: string = STATE_DIR,
): void {
  const filePath = oauthStorePath(stateDir);
  const store = readStore(filePath);
  store.tokens[name] = token;
  writeStore(filePath, store);
}

export function deleteMcpOAuthToken(name: string, stateDir: string = STATE_DIR): void {
  const filePath = oauthStorePath(stateDir);
  const store = readStore(filePath);
  delete store.tokens[name];
  // Clean up any stale states targeting this name.
  for (const state of Object.keys(store.states)) {
    if (store.states[state]?.name === name) {
      delete store.states[state];
    }
  }
  writeStore(filePath, store);
}

export function createMcpOAuthState(
  record: Omit<McpOAuthStateRecord, "createdAtMs">,
  stateDir: string = STATE_DIR,
): string {
  const filePath = oauthStorePath(stateDir);
  const store = readStore(filePath);
  const state = crypto.randomBytes(24).toString("base64url");
  store.states[state] = { ...record, createdAtMs: Date.now() };
  writeStore(filePath, store);
  return state;
}

export function consumeMcpOAuthState(
  state: string,
  stateDir: string = STATE_DIR,
): McpOAuthStateRecord | null {
  const filePath = oauthStorePath(stateDir);
  const store = readStore(filePath);
  const record = store.states[state];
  if (!record) {
    return null;
  }
  delete store.states[state];
  writeStore(filePath, store);
  return record;
}

/**
 * Expire pending OAuth states older than the given TTL (default 10 minutes).
 * Returns the number of removed entries.
 */
export function pruneExpiredMcpOAuthStates(
  ttlMs: number = 10 * 60 * 1000,
  stateDir: string = STATE_DIR,
): number {
  const filePath = oauthStorePath(stateDir);
  const store = readStore(filePath);
  const cutoff = Date.now() - ttlMs;
  let removed = 0;
  for (const state of Object.keys(store.states)) {
    const record = store.states[state];
    if (record?.createdAtMs && record.createdAtMs < cutoff) {
      delete store.states[state];
      removed += 1;
    }
  }
  if (removed > 0) {
    writeStore(filePath, store);
  }
  return removed;
}

export function buildMcpOAuthAuthorizeUrl(params: {
  authorizeUrl: string;
  clientId: string;
  redirectUri: string;
  state: string;
  scopes?: string[];
  codeChallenge?: string;
  codeChallengeMethod?: "S256";
  extra?: Record<string, string>;
}): string {
  const url = new URL(params.authorizeUrl);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", params.clientId);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("state", params.state);
  if (params.scopes && params.scopes.length > 0) {
    url.searchParams.set("scope", params.scopes.join(" "));
  }
  if (params.codeChallenge) {
    url.searchParams.set("code_challenge", params.codeChallenge);
    url.searchParams.set("code_challenge_method", params.codeChallengeMethod ?? "S256");
  }
  if (params.extra) {
    for (const [key, value] of Object.entries(params.extra)) {
      if (!url.searchParams.has(key)) {
        url.searchParams.set(key, value);
      }
    }
  }
  return url.toString();
}
