/**
 * Session registry for the embedded (server-side headless-browser) MCP OAuth
 * flow. The gateway launches a headless Chromium, the Control UI polls JPEG
 * screenshots and relays pointer/keyboard input, and when the browser reaches
 * the OAuth redirect URI we run the *existing* token exchange
 * (`completeMcpOAuthFlow`) — this module is only a new front-end to it.
 *
 * All `puppeteer-core` usage is isolated behind the lazily-imported
 * `mcp-oauth-embedded.runtime.ts` boundary, so this registry (and the gateway
 * that imports it) stays free of the optional dependency.
 */
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { platform } from "node:process";

export type EmbeddedPhase = "loading" | "interactive" | "done" | "error";

export type EmbeddedInputEvent =
  | {
      kind: "mouse";
      action: "move" | "down" | "up" | "click";
      x: number;
      y: number;
      button?: "left" | "right" | "middle";
    }
  | { kind: "wheel"; x: number; y: number; deltaX: number; deltaY: number }
  | { kind: "key"; action: "press" | "type"; text?: string; key?: string };

/** The small contract the registry drives; implemented by the runtime driver. */
export type EmbeddedBrowserHandle = {
  screenshot(): Promise<{ dataBase64: string; w: number; h: number } | null>;
  input(ev: EmbeddedInputEvent): Promise<void>;
  close(): Promise<void>;
};

export type EmbeddedRedirectResult = { code?: string; state?: string; error?: string };

export type EmbeddedLaunchArgs = {
  chromiumPath: string;
  userDataDir: string;
  authorizeUrl: string;
  redirectUriPrefix: string;
  viewport: { w: number; h: number };
  onRedirect: (result: EmbeddedRedirectResult) => void;
  onClosed?: () => void;
};

/** Result of the reused token exchange, surfaced to the poller. */
export type EmbeddedCompleteResult = {
  ok: boolean;
  message?: string;
  providerName?: string;
  expiresAtMs?: number | null;
};

export type EmbeddedStartArgs = {
  connId: string;
  name: string;
  authorizeUrl: string;
  oauthState: string;
  chromiumPath: string;
  redirectUriPrefix: string;
  viewport: { w: number; h: number };
  providerName?: string;
  /** Reuses `completeMcpOAuthFlow`; injected by the handler for testability. */
  onComplete: (args: {
    name: string;
    state: string;
    code: string;
  }) => Promise<EmbeddedCompleteResult>;
};

export type EmbeddedPollResult = {
  phase: EmbeddedPhase;
  seq: number;
  frame?: { dataBase64: string; w: number; h: number };
  message?: string;
  providerName?: string;
  expiresAtMs?: number | null;
};

type EmbeddedSession = {
  sessionId: string;
  connId: string;
  name: string;
  handle: EmbeddedBrowserHandle | null;
  userDataDir: string;
  phase: EmbeddedPhase;
  seq: number;
  message?: string;
  providerName?: string;
  expiresAtMs?: number | null;
  timer: ReturnType<typeof setTimeout> | null;
  redirectHandled: boolean;
};

const MACOS_CHROMIUM_CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
];

const LINUX_CHROMIUM_CANDIDATES = [
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/microsoft-edge",
  "/snap/bin/chromium",
];

/**
 * Resolve a Chromium executable path. Order: explicit config → env
 * (`PUPPETEER_EXECUTABLE_PATH` / `CHROME_PATH` / `CHROMIUM_PATH`) → platform
 * default probe. Returns `null` when nothing resolvable — the caller then
 * reports the embedded flow unavailable and the UI falls back to the popup.
 */
export function resolveChromiumPath(configuredPath?: string | null): string | null {
  if (configuredPath && existsSync(configuredPath)) {
    return configuredPath;
  }
  const envPath =
    process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROME_PATH || process.env.CHROMIUM_PATH;
  if (envPath && existsSync(envPath)) {
    return envPath;
  }
  const candidates = platform === "darwin" ? MACOS_CHROMIUM_CANDIDATES : LINUX_CHROMIUM_CANDIDATES;
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

/** Whether a Chromium executable resolves AND `puppeteer-core` is importable. */
export async function probeEmbeddedBrowserAvailable(
  configuredPath?: string | null,
): Promise<boolean> {
  if (!resolveChromiumPath(configuredPath)) {
    return false;
  }
  if (_launcher) {
    return true;
  }
  const runtime = await import("./mcp-oauth-embedded.runtime.js");
  return runtime.puppeteerLoadable();
}

const SESSION_TIMEOUT_MS = 180_000;
const MAX_CONCURRENT_SESSIONS = 2;
const DEFAULT_VIEWPORT = { w: 520, h: 720 };

// Injectable launcher so unit tests can drive the registry without a real
// Chromium. Defaults to the lazily-imported puppeteer-core driver.
type LauncherFn = (args: EmbeddedLaunchArgs) => Promise<EmbeddedBrowserHandle>;
let _launcher: LauncherFn | null = null;

/** Override the browser launcher (tests). Pass `null` to restore the default. */
export function setEmbeddedBrowserLauncher(launcher: LauncherFn | null): void {
  _launcher = launcher;
}

async function launch(args: EmbeddedLaunchArgs): Promise<EmbeddedBrowserHandle> {
  if (_launcher) {
    return _launcher(args);
  }
  const runtime = await import("./mcp-oauth-embedded.runtime.js");
  return runtime.launchEmbeddedBrowser(args);
}

const sessions = new Map<string, EmbeddedSession>();

export function normalizeViewport(v?: { w?: number; h?: number }): { w: number; h: number } {
  const w = Math.min(1280, Math.max(320, Math.round(v?.w ?? DEFAULT_VIEWPORT.w)));
  const h = Math.min(1600, Math.max(480, Math.round(v?.h ?? DEFAULT_VIEWPORT.h)));
  return { w, h };
}

function teardownSession(session: EmbeddedSession): void {
  if (session.timer) {
    clearTimeout(session.timer);
    session.timer = null;
  }
  const handle = session.handle;
  session.handle = null;
  if (handle) {
    void handle.close().catch(() => {});
  }
  try {
    rmSync(session.userDataDir, { recursive: true, force: true });
  } catch {
    // best effort
  }
}

function disposeSession(sessionId: string): void {
  const session = sessions.get(sessionId);
  if (!session) {
    return;
  }
  teardownSession(session);
  sessions.delete(sessionId);
}

/**
 * Begin an embedded OAuth flow: allocate a session, spawn the headless browser,
 * and wire redirect capture to the injected token exchange. Returns the opaque
 * session id the UI polls.
 */
export async function startEmbeddedOAuth(
  args: EmbeddedStartArgs,
): Promise<{ sessionId: string; viewport: { w: number; h: number }; providerName?: string }> {
  // One live flow per connection; drop any prior one.
  for (const existing of sessions.values()) {
    if (existing.connId === args.connId) {
      disposeSession(existing.sessionId);
    }
  }
  if (sessions.size >= MAX_CONCURRENT_SESSIONS) {
    throw new Error("Too many embedded OAuth sessions in progress. Try again shortly.");
  }

  const sessionId = randomUUID();
  const userDataDir = mkdtempSync(join(tmpdir(), "genesis-mcp-oauth-"));
  const session: EmbeddedSession = {
    sessionId,
    connId: args.connId,
    name: args.name,
    handle: null,
    userDataDir,
    phase: "loading",
    seq: 0,
    providerName: args.providerName,
    timer: null,
    redirectHandled: false,
  };
  sessions.set(sessionId, session);

  session.timer = setTimeout(() => {
    const s = sessions.get(sessionId);
    if (s && s.phase !== "done") {
      s.phase = "error";
      s.message = "Embedded OAuth flow timed out.";
      const handle = s.handle;
      s.handle = null;
      if (handle) {
        void handle.close().catch(() => {});
      }
    }
  }, SESSION_TIMEOUT_MS);

  const onRedirect = (result: EmbeddedRedirectResult): void => {
    const s = sessions.get(sessionId);
    if (!s || s.redirectHandled) {
      return;
    }
    s.redirectHandled = true;
    void handleRedirect(s, args, result);
  };

  try {
    const handle = await launch({
      chromiumPath: args.chromiumPath,
      userDataDir,
      authorizeUrl: args.authorizeUrl,
      redirectUriPrefix: args.redirectUriPrefix,
      viewport: args.viewport,
      onRedirect,
      onClosed: () => {
        const s = sessions.get(sessionId);
        if (s && s.phase === "loading") {
          s.phase = "error";
          s.message = "Headless browser closed unexpectedly.";
        }
      },
    });
    session.handle = handle;
    if (session.phase === "loading") {
      session.phase = "interactive";
    }
  } catch (err) {
    disposeSession(sessionId);
    throw err instanceof Error ? err : new Error(String(err));
  }

  return { sessionId, viewport: args.viewport, providerName: args.providerName };
}

async function handleRedirect(
  session: EmbeddedSession,
  args: EmbeddedStartArgs,
  result: EmbeddedRedirectResult,
): Promise<void> {
  if (result.error) {
    session.phase = "error";
    session.message = `Provider returned error: ${result.error}`;
    return;
  }
  if (!result.code || !result.state) {
    session.phase = "error";
    session.message = "Redirect did not include an authorization code.";
    return;
  }
  if (result.state !== args.oauthState) {
    session.phase = "error";
    session.message = "OAuth state mismatch.";
    return;
  }
  try {
    const outcome = await args.onComplete({
      name: args.name,
      state: result.state,
      code: result.code,
    });
    session.phase = outcome.ok ? "done" : "error";
    session.message = outcome.message;
    session.providerName = outcome.providerName ?? session.providerName;
    session.expiresAtMs = outcome.expiresAtMs ?? null;
  } catch (err) {
    session.phase = "error";
    session.message = err instanceof Error ? err.message : String(err);
  } finally {
    // Browser is no longer needed once the code is captured.
    const handle = session.handle;
    session.handle = null;
    if (handle) {
      void handle.close().catch(() => {});
    }
  }
}

/** Poll the current phase and (when interactive) a fresh JPEG screenshot. */
export async function pollEmbeddedOAuth(sessionId: string): Promise<EmbeddedPollResult | null> {
  const session = sessions.get(sessionId);
  if (!session) {
    return null;
  }
  let frame: { dataBase64: string; w: number; h: number } | undefined;
  if (session.phase === "interactive" && session.handle) {
    const shot = await session.handle.screenshot();
    if (shot) {
      frame = shot;
      session.seq += 1;
    }
  }
  return {
    phase: session.phase,
    seq: session.seq,
    frame,
    message: session.message,
    providerName: session.providerName,
    expiresAtMs: session.expiresAtMs ?? null,
  };
}

/** Relay one pointer/keyboard event into the headless page. */
export async function inputEmbeddedOAuth(
  sessionId: string,
  ev: EmbeddedInputEvent,
): Promise<boolean> {
  const session = sessions.get(sessionId);
  if (!session || session.phase !== "interactive" || !session.handle) {
    return false;
  }
  try {
    await session.handle.input(ev);
    return true;
  } catch {
    return false;
  }
}

/** Cancel and tear down a session. */
export function cancelEmbeddedOAuth(sessionId: string): boolean {
  if (!sessions.has(sessionId)) {
    return false;
  }
  disposeSession(sessionId);
  return true;
}

/** Tear down any sessions owned by a dropped connection. */
export function teardownEmbeddedForConn(connId: string): void {
  for (const session of Array.from(sessions.values())) {
    if (session.connId === connId) {
      disposeSession(session.sessionId);
    }
  }
}

/** Tear down every session (gateway shutdown). */
export function teardownAllEmbeddedOAuth(): void {
  for (const sessionId of Array.from(sessions.keys())) {
    disposeSession(sessionId);
  }
}

/** Test/introspection helper. */
export function embeddedSessionCount(): number {
  return sessions.size;
}
