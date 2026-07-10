import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { STATE_DIR } from "../config/paths.js";
import { logWarn } from "../logger.js";

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
  /** Token endpoint, retained so the access token can be refreshed later. */
  tokenUrl?: string;
  /** RFC 7009 revocation endpoint, if advertised; used on disconnect. */
  revokeUrl?: string;
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
  /**
   * Token endpoint auto-discovered at flow start (well-known metadata), used
   * when `mcp.servers.<name>.auth.tokenUrl` is not explicitly configured.
   */
  discoveredTokenUrl?: string;
};

type McpOAuthStore = {
  tokens: Record<string, McpOAuthTokenRecord>;
  states: Record<string, McpOAuthStateRecord>;
};

const MCP_OAUTH_FILENAME = "mcp-oauth.json";
const MCP_OAUTH_KEY_FILENAME = "mcp-oauth.key";
const FILE_MODE = 0o600;
const ENVELOPE_VERSION = 2 as const;

/**
 * On-disk envelope. Tokens are encrypted at rest with AES-256-GCM under a
 * machine-local key (see {@link loadOrCreateKey}). Version 1 (plaintext
 * `{ tokens, states }`) is still readable and is transparently migrated to the
 * encrypted form on the next write.
 */
type McpOAuthEnvelope = {
  v: typeof ENVELOPE_VERSION;
  enc: "aes-256-gcm";
  nonce: string;
  tag: string;
  ciphertext: string;
};

function oauthStorePath(stateDir: string = STATE_DIR): string {
  return path.join(stateDir, MCP_OAUTH_FILENAME);
}

function oauthKeyPath(stateDir: string = STATE_DIR): string {
  return path.join(stateDir, MCP_OAUTH_KEY_FILENAME);
}

function writeFileAtomicSync(filePath: string, data: string | Buffer): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  fs.writeFileSync(tmp, data, { mode: FILE_MODE });
  try {
    fs.chmodSync(tmp, FILE_MODE);
  } catch {
    // best-effort; some filesystems do not support chmod
  }
  fs.renameSync(tmp, filePath);
  try {
    fs.chmodSync(filePath, FILE_MODE);
  } catch {
    // best-effort
  }
}

/**
 * Load the machine-local 256-bit encryption key, creating it on first use.
 * The key file is written with 0600 perms next to the token store. A malformed
 * existing key is regenerated (any previously stored tokens then read as
 * "no token" and the user simply re-authorizes); the token file is never
 * deleted here.
 */
function loadOrCreateKey(stateDir: string = STATE_DIR): Buffer {
  const keyPath = oauthKeyPath(stateDir);
  try {
    const raw = fs.readFileSync(keyPath, "utf8").trim();
    const buf = Buffer.from(raw, "base64");
    if (buf.length === 32) {
      return buf;
    }
    logWarn(
      `mcp-oauth: key file at ${keyPath} is malformed; regenerating (stored tokens will be dropped).`,
    );
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      logWarn(`mcp-oauth: unable to read key file (${(err as Error).message}); regenerating.`);
    }
  }
  const key = crypto.randomBytes(32);
  writeFileAtomicSync(keyPath, key.toString("base64"));
  return key;
}

/** Read the key for decryption only; returns null when absent/unreadable. */
function readKeyForDecrypt(stateDir: string): Buffer | null {
  try {
    const raw = fs.readFileSync(oauthKeyPath(stateDir), "utf8").trim();
    const buf = Buffer.from(raw, "base64");
    return buf.length === 32 ? buf : null;
  } catch {
    return null;
  }
}

function encryptStore(store: McpOAuthStore, key: Buffer): McpOAuthEnvelope {
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, nonce);
  const plaintext = Buffer.from(JSON.stringify(store), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    v: ENVELOPE_VERSION,
    enc: "aes-256-gcm",
    nonce: nonce.toString("base64"),
    tag: tag.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}

function decryptStore(envelope: McpOAuthEnvelope, stateDir: string): McpOAuthStore {
  const key = readKeyForDecrypt(stateDir);
  if (!key) {
    logWarn(
      "mcp-oauth: token store is encrypted but the key is missing/unreadable; treating as empty.",
    );
    return { tokens: {}, states: {} };
  }
  try {
    const nonce = Buffer.from(envelope.nonce, "base64");
    const tag = Buffer.from(envelope.tag, "base64");
    const ciphertext = Buffer.from(envelope.ciphertext, "base64");
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, nonce);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    const parsed = JSON.parse(plaintext.toString("utf8")) as Partial<McpOAuthStore>;
    return { tokens: parsed.tokens ?? {}, states: parsed.states ?? {} };
  } catch (err) {
    // Key changed or file corrupted: fail closed to "no token" but never delete
    // the file, so an operator can investigate/restore.
    logWarn(
      `mcp-oauth: unable to decrypt token store (${(err as Error).message}); treating as empty.`,
    );
    return { tokens: {}, states: {} };
  }
}

function readStore(filePath: string, stateDir: string): McpOAuthStore {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { tokens: {}, states: {} };
    }
    throw err;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    logWarn(
      `mcp-oauth: token store is not valid JSON (${(err as Error).message}); treating as empty.`,
    );
    return { tokens: {}, states: {} };
  }
  if (parsed && typeof parsed === "object" && (parsed as McpOAuthEnvelope).enc === "aes-256-gcm") {
    return decryptStore(parsed as McpOAuthEnvelope, stateDir);
  }
  // Legacy v1 plaintext store; migrated to encrypted form on next write.
  const legacy = parsed as Partial<McpOAuthStore>;
  return { tokens: legacy.tokens ?? {}, states: legacy.states ?? {} };
}

function writeStore(filePath: string, store: McpOAuthStore, stateDir: string): void {
  const key = loadOrCreateKey(stateDir);
  const envelope = encryptStore(store, key);
  writeFileAtomicSync(filePath, `${JSON.stringify(envelope, null, 2)}\n`);
}

export function listMcpOAuthTokens(
  stateDir: string = STATE_DIR,
): Record<string, McpOAuthTokenRecord> {
  return readStore(oauthStorePath(stateDir), stateDir).tokens;
}

export function getMcpOAuthToken(
  name: string,
  stateDir: string = STATE_DIR,
): McpOAuthTokenRecord | null {
  const tokens = readStore(oauthStorePath(stateDir), stateDir).tokens;
  return tokens[name] ?? null;
}

export function setMcpOAuthToken(
  name: string,
  token: McpOAuthTokenRecord,
  stateDir: string = STATE_DIR,
): void {
  const filePath = oauthStorePath(stateDir);
  const store = readStore(filePath, stateDir);
  store.tokens[name] = token;
  writeStore(filePath, store, stateDir);
}

export function deleteMcpOAuthToken(name: string, stateDir: string = STATE_DIR): void {
  const filePath = oauthStorePath(stateDir);
  const store = readStore(filePath, stateDir);
  delete store.tokens[name];
  // Clean up any stale states targeting this name.
  for (const state of Object.keys(store.states)) {
    if (store.states[state]?.name === name) {
      delete store.states[state];
    }
  }
  writeStore(filePath, store, stateDir);
}

export function createMcpOAuthState(
  record: Omit<McpOAuthStateRecord, "createdAtMs">,
  stateDir: string = STATE_DIR,
): string {
  const filePath = oauthStorePath(stateDir);
  const store = readStore(filePath, stateDir);
  const state = crypto.randomBytes(24).toString("base64url");
  store.states[state] = { ...record, createdAtMs: Date.now() };
  writeStore(filePath, store, stateDir);
  return state;
}

export function consumeMcpOAuthState(
  state: string,
  stateDir: string = STATE_DIR,
): McpOAuthStateRecord | null {
  const filePath = oauthStorePath(stateDir);
  const store = readStore(filePath, stateDir);
  const record = store.states[state];
  if (!record) {
    return null;
  }
  delete store.states[state];
  writeStore(filePath, store, stateDir);
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
  const store = readStore(filePath, stateDir);
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
    writeStore(filePath, store, stateDir);
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

/**
 * Generate a PKCE (RFC 7636) verifier/challenge pair using S256. The verifier
 * is a 32-byte base64url random string; the challenge is base64url(sha256).
 */
export function generatePkcePair(): { codeVerifier: string; codeChallenge: string } {
  const codeVerifier = crypto.randomBytes(32).toString("base64url");
  const codeChallenge = crypto.createHash("sha256").update(codeVerifier).digest("base64url");
  return { codeVerifier, codeChallenge };
}
