import { t } from "../../i18n/index.ts";
import type { GatewayBrowserClient } from "../gateway.ts";

export type McpServersMap = Record<string, Record<string, unknown>>;

export type McpMessage = { kind: "success" | "error"; text: string };

/**
 * Structural subset of the app view-state consumed by the MCP controller.
 * Mirrors the pattern used by {@link ../controllers/skills.ts}.
 */
export type McpState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  mcpServersLoading: boolean;
  mcpServers: McpServersMap | null;
  mcpServersPath: string | null;
  mcpServersError: string | null;
  mcpBusy: boolean;
  mcpMessage: McpMessage | null;
  mcpDraftName: string;
  mcpDraftConfig: string;
  mcpAuthToken: string;
  mcpLinkUrl: string;
  mcpLinkMetadataLoading: boolean;
  mcpLinkMetadataError: string | null;
  mcpLinkMetadata: McpServerMetadata | null;
  mcpOAuthStatus: Record<string, McpOAuthStatus>;
  mcpOAuthFlow: McpOAuthFlow | null;
  mcpOAuthPopup: Window | null;
  mcpEmbeddedFlow: McpEmbeddedFlow | null;
  mcpEmbeddedPollTimer: ReturnType<typeof setTimeout> | null;
  mcpEmbeddedPopup: Window | null;
  mcpTestStatus: Record<string, { ok: boolean; message: string } | null>;
};

export type McpServerMetadata = {
  /** Server name suggested by the server (serverInfo.name) or derived from URL. */
  name: string;
  /** Endpoint URL the metadata was fetched from. */
  url: string;
  /** Detected MCP transport. */
  transport: "streamable-http" | "sse";
  /** Optional serverInfo.name. */
  serverName?: string;
  /** Optional serverInfo.version. */
  serverVersion?: string;
  /** Optional protocolVersion advertised. */
  protocolVersion?: string;
  /** Optional list of tool/prompt/resource names advertised by the server. */
  capabilities?: { tools?: string[]; prompts?: string[]; resources?: string[] };
  /** Whether the server advertised OAuth metadata. */
  oauth: boolean;
  /** Issuer URL advertised by the server (for OAuth dynamic registration). */
  oauthIssuer?: string;
  /** Authorization endpoint URL discovered for OAuth. */
  oauthAuthorizeUrl?: string;
  /** Token endpoint URL discovered for OAuth. */
  oauthTokenUrl?: string;
  /** Optional list of scopes advertised in OAuth metadata. */
  oauthScopes?: string[];
};

export type McpOAuthStatus = {
  /** Server has stored tokens and the access token is not expired. */
  connected: boolean;
  /** Epoch ms when the access token expires, if known. */
  expiresAtMs?: number | null;
  /** Server name from the provider. */
  providerName?: string;
  /** Whether the server requires re-auth. */
  requiresAuth: boolean;
};

export type McpOAuthFlow = {
  /** Server name being authorized. */
  name: string;
  /** State nonce to validate in the callback. */
  state: string;
  /** Authorize URL the user should open. */
  authorizeUrl: string;
  /** Epoch ms when this flow was started. */
  startedAtMs: number;
  /** Optional provider name. */
  providerName?: string;
  /** Optional error message. */
  error?: string;
};

export type McpEmbeddedPhase = "loading" | "interactive" | "done" | "error";

export type McpEmbeddedFrame = { dataBase64: string; w: number; h: number };

/** Live state of a server-side headless-browser (embedded) OAuth flow. */
export type McpEmbeddedFlow = {
  name: string;
  sessionId: string;
  viewport: { w: number; h: number };
  phase: McpEmbeddedPhase;
  frame: McpEmbeddedFrame | null;
  seq: number;
  providerName?: string;
  message?: string;
};

export type McpEmbeddedInput =
  | {
      kind: "mouse";
      action: "move" | "down" | "up" | "click";
      x: number;
      y: number;
      button?: "left" | "right" | "middle";
    }
  | { kind: "wheel"; x: number; y: number; deltaX: number; deltaY: number }
  | { kind: "key"; action: "press" | "type"; text?: string; key?: string };

type McpServersResult = {
  path: string;
  servers: McpServersMap;
  removed?: boolean;
};

type McpMetadataResult = McpServerMetadata;

type McpOAuthStartResult = {
  state: string;
  authorizeUrl: string;
  providerName?: string;
};

type McpOAuthCallbackResult = {
  ok: boolean;
  message?: string;
  providerName?: string;
  expiresAtMs?: number | null;
};

type McpOAuthStatusResult = McpOAuthStatus;

type McpTestResult = {
  ok: boolean;
  message: string;
};

type McpEmbeddedStartResult = {
  sessionId: string;
  viewport: { w: number; h: number };
  providerName?: string;
};

type McpEmbeddedPollResult = {
  phase: McpEmbeddedPhase;
  seq: number;
  frame?: McpEmbeddedFrame;
  message?: string;
  providerName?: string;
  expiresAtMs?: number | null;
};

const EMBEDDED_POLL_INTERVAL_MS = 500;

const getErrorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

export async function loadMcpServers(state: McpState) {
  if (!state.client || !state.connected || state.mcpServersLoading) {
    return;
  }
  state.mcpServersLoading = true;
  state.mcpServersError = null;
  try {
    const res = await state.client.request<McpServersResult>("mcp.servers.list", {});
    state.mcpServers = res?.servers ?? {};
    state.mcpServersPath = res?.path ?? null;
  } catch (err) {
    state.mcpServersError = getErrorMessage(err);
  } finally {
    state.mcpServersLoading = false;
  }
}

export async function saveMcpServer(
  state: McpState,
  name: string,
  server: Record<string, unknown>,
) {
  if (!state.client || !state.connected) {
    return;
  }
  const trimmed = name.trim();
  if (!trimmed) {
    state.mcpMessage = { kind: "error", text: "MCP server name is required." };
    return;
  }
  state.mcpBusy = true;
  state.mcpMessage = null;
  try {
    const res = await state.client.request<McpServersResult>("mcp.servers.set", {
      name: trimmed,
      server,
    });
    state.mcpServers = res?.servers ?? state.mcpServers;
    state.mcpServersPath = res?.path ?? state.mcpServersPath;
    state.mcpMessage = { kind: "success", text: `Saved MCP server "${trimmed}".` };
    state.mcpDraftName = "";
    state.mcpDraftConfig = "";
    state.mcpAuthToken = "";
  } catch (err) {
    state.mcpMessage = { kind: "error", text: getErrorMessage(err) };
  } finally {
    state.mcpBusy = false;
  }
}

export async function deleteMcpServer(state: McpState, name: string) {
  if (!state.client || !state.connected) {
    return;
  }
  state.mcpBusy = true;
  state.mcpMessage = null;
  try {
    const res = await state.client.request<McpServersResult>("mcp.servers.unset", { name });
    state.mcpServers = res?.servers ?? state.mcpServers;
    state.mcpServersPath = res?.path ?? state.mcpServersPath;
    state.mcpMessage =
      res?.removed === false
        ? { kind: "error", text: `No MCP server named "${name}".` }
        : { kind: "success", text: `Removed MCP server "${name}".` };
  } catch (err) {
    state.mcpMessage = { kind: "error", text: getErrorMessage(err) };
  } finally {
    state.mcpBusy = false;
  }
}

export async function fetchMcpServerMetadata(
  state: McpState,
  rawUrl: string,
): Promise<McpServerMetadata | null> {
  if (!state.client || !state.connected) {
    return null;
  }
  const url = rawUrl.trim();
  if (!url) {
    state.mcpLinkMetadataError = "Enter a server URL.";
    return null;
  }
  state.mcpLinkMetadataLoading = true;
  state.mcpLinkMetadataError = null;
  try {
    const res = await state.client.request<McpMetadataResult>("mcp.servers.metadata", { url });
    state.mcpLinkMetadata = res;
    return res;
  } catch (err) {
    state.mcpLinkMetadataError = getErrorMessage(err);
    state.mcpLinkMetadata = null;
    return null;
  } finally {
    state.mcpLinkMetadataLoading = false;
  }
}

export async function testMcpServer(state: McpState, name: string) {
  if (!state.client || !state.connected) {
    return;
  }
  try {
    const res = await state.client.request<McpTestResult>("mcp.servers.test", { name });
    state.mcpTestStatus = {
      ...state.mcpTestStatus,
      [name]: { ok: res?.ok ?? false, message: res?.message ?? "" },
    };
  } catch (err) {
    state.mcpTestStatus = {
      ...state.mcpTestStatus,
      [name]: { ok: false, message: getErrorMessage(err) },
    };
  }
}

export async function loadMcpOAuthStatuses(state: McpState) {
  if (!state.client || !state.connected) {
    return;
  }
  const servers = state.mcpServers ?? {};
  const names = Object.keys(servers);
  const next: Record<string, McpOAuthStatus> = {};
  await Promise.all(
    names.map(async (name) => {
      try {
        const res = await state.client!.request<McpOAuthStatusResult>("mcp.oauth.status", { name });
        next[name] = res;
      } catch {
        next[name] = { connected: false, requiresAuth: false };
      }
    }),
  );
  state.mcpOAuthStatus = next;
}

export async function startMcpOAuth(
  state: McpState,
  name: string,
  scopes?: string[],
): Promise<McpOAuthFlow | null> {
  if (!state.client || !state.connected) {
    return null;
  }
  try {
    const res = await state.client.request<McpOAuthStartResult>("mcp.oauth.start", {
      name,
      scopes,
      // The popup opens in this browser, so the OAuth provider must redirect
      // back to an origin this browser can reach — which may differ from the
      // gateway's own (often loopback) resolved web URL.
      origin: window.location.origin,
    });
    const flow: McpOAuthFlow = {
      name,
      state: res.state,
      authorizeUrl: res.authorizeUrl,
      startedAtMs: Date.now(),
      providerName: res.providerName,
    };
    state.mcpOAuthFlow = flow;
    return flow;
  } catch (err) {
    state.mcpMessage = { kind: "error", text: `OAuth start failed: ${getErrorMessage(err)}` };
    return null;
  }
}

export async function completeMcpOAuth(
  state: McpState,
  code: string,
  oauthState: string,
): Promise<boolean> {
  if (!state.client || !state.connected) {
    return false;
  }
  const flow = state.mcpOAuthFlow;
  if (!flow) {
    return false;
  }
  if (flow.state !== oauthState) {
    state.mcpMessage = { kind: "error", text: "OAuth state mismatch; restart the flow." };
    state.mcpOAuthFlow = null;
    return false;
  }
  try {
    const res = await state.client.request<McpOAuthCallbackResult>("mcp.oauth.callback", {
      name: flow.name,
      state: oauthState,
      code,
    });
    if (res?.ok) {
      state.mcpOAuthStatus = {
        ...state.mcpOAuthStatus,
        [flow.name]: {
          connected: true,
          requiresAuth: false,
          providerName: res.providerName ?? flow.providerName,
          expiresAtMs: res.expiresAtMs ?? null,
        },
      };
      state.mcpMessage = {
        kind: "success",
        text: `Connected to "${flow.name}".`,
      };
    } else {
      state.mcpMessage = {
        kind: "error",
        text: res?.message ?? "OAuth callback failed.",
      };
    }
    state.mcpOAuthFlow = null;
    return res?.ok ?? false;
  } catch (err) {
    state.mcpMessage = { kind: "error", text: `OAuth failed: ${getErrorMessage(err)}` };
    state.mcpOAuthFlow = null;
    return false;
  }
}

function stopEmbeddedPoll(state: McpState) {
  if (state.mcpEmbeddedPollTimer) {
    clearTimeout(state.mcpEmbeddedPollTimer);
    state.mcpEmbeddedPollTimer = null;
  }
}

const EMBEDDED_POPUP_CLOSE_DELAY_OK_MS = 800;
const EMBEDDED_POPUP_CLOSE_DELAY_ERROR_MS = 1500;

/** Map a special keyboard key to a CDP/puppeteer key name, or null if printable. */
function mapEmbeddedSpecialKey(key: string): string | null {
  switch (key) {
    case "Enter":
    case "Tab":
    case "Backspace":
    case "Delete":
    case "Escape":
    case "ArrowUp":
    case "ArrowDown":
    case "ArrowLeft":
    case "ArrowRight":
    case "Home":
    case "End":
    case "PageUp":
    case "PageDown":
      return key;
    default:
      return null;
  }
}

function embeddedPopupPoint(
  ev: MouseEvent,
  stage: HTMLElement,
  viewport: { w: number; h: number },
): { x: number; y: number } {
  const rect = stage.getBoundingClientRect();
  const x = rect.width > 0 ? ((ev.clientX - rect.left) / rect.width) * viewport.w : 0;
  const y = rect.height > 0 ? ((ev.clientY - rect.top) / rect.height) * viewport.h : 0;
  return { x: Math.round(x), y: Math.round(y) };
}

function closeEmbeddedPopup(state: McpState) {
  const popup = state.mcpEmbeddedPopup;
  state.mcpEmbeddedPopup = null;
  if (popup && !popup.closed) {
    try {
      popup.close();
    } catch {
      // ignore
    }
  }
}

function scheduleEmbeddedPopupClose(state: McpState, delayMs: number) {
  const popup = state.mcpEmbeddedPopup;
  if (!popup) {
    return;
  }
  setTimeout(() => {
    // Only close it if a newer flow hasn't already replaced it.
    if (state.mcpEmbeddedPopup === popup) {
      closeEmbeddedPopup(state);
    }
  }, delayMs);
}

/** Refresh the popup's status text and streamed frame from current state. */
function updateEmbeddedPopup(state: McpState) {
  const popup = state.mcpEmbeddedPopup;
  const flow = state.mcpEmbeddedFlow;
  if (!popup || popup.closed || !flow) {
    return;
  }
  const statusEl = popup.document.getElementById("status");
  if (statusEl) {
    statusEl.textContent =
      flow.phase === "loading"
        ? t("mcpView.oauth.embedded.loading")
        : t("mcpView.oauth.embedded.subtitle");
  }
  const stage = popup.document.getElementById("stage");
  if (stage) {
    stage.style.cursor = flow.phase === "interactive" ? "crosshair" : "progress";
    if (flow.frame) {
      let img = stage.querySelector("img");
      if (!img) {
        img = popup.document.createElement("img");
        img.draggable = false;
        stage.appendChild(img);
      }
      img.src = `data:image/jpeg;base64,${flow.frame.dataBase64}`;
    }
  }
}

/**
 * Open the popup window that hosts a streamed embedded OAuth session and wire
 * pointer/keyboard/paste input straight into `sendMcpEmbeddedInput`. Mirrors
 * the real-browser popup flow's UX (a dedicated window) even though the
 * gateway's headless browser is doing the actual navigating.
 */
function openEmbeddedPopup(state: McpState, flow: McpEmbeddedFlow): Window | null {
  const { w, h } = flow.viewport;
  const popup = window.open(
    "",
    `mcp-oauth-embedded-${encodeURIComponent(flow.name)}`,
    `width=${w},height=${h + 40},noopener=no`,
  );
  if (!popup) {
    return null;
  }
  popup.document.open();
  popup.document.write(`<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><title>Genesis · MCP OAuth</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; background: #0f172a; color: #e2e8f0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
  #status { padding: 8px 12px; font-size: 13px; border-bottom: 1px solid #1e293b; color: #94a3b8; }
  #stage { position: relative; width: 100vw; height: calc(100vh - 37px); overflow: hidden; background: #111; outline: none; }
  #stage img { display: block; width: 100%; height: 100%; user-select: none; pointer-events: none; }
</style></head>
<body>
<div id="status"></div>
<div id="stage" tabindex="0"></div>
</body></html>`);
  popup.document.close();
  popup.document.title = t("mcpView.oauth.embedded.title", { name: flow.name });

  const stage = popup.document.getElementById("stage")!;
  const currentFlow = () => state.mcpEmbeddedFlow;
  const isInteractive = () => currentFlow()?.phase === "interactive";
  let pointerDown = false;
  let lastMoveMs = 0;

  stage.addEventListener("mousedown", (ev) => {
    if (!isInteractive()) {
      return;
    }
    ev.preventDefault();
    stage.focus();
    pointerDown = true;
    const p = embeddedPopupPoint(ev, stage, currentFlow()!.viewport);
    void sendMcpEmbeddedInput(state, { kind: "mouse", action: "down", x: p.x, y: p.y });
  });
  stage.addEventListener("mouseup", (ev) => {
    if (!isInteractive()) {
      return;
    }
    pointerDown = false;
    const p = embeddedPopupPoint(ev, stage, currentFlow()!.viewport);
    void sendMcpEmbeddedInput(state, { kind: "mouse", action: "up", x: p.x, y: p.y });
  });
  stage.addEventListener("mousemove", (ev) => {
    if (!isInteractive() || !pointerDown) {
      return;
    }
    const now = Date.now();
    if (now - lastMoveMs < 40) {
      return;
    }
    lastMoveMs = now;
    const p = embeddedPopupPoint(ev, stage, currentFlow()!.viewport);
    void sendMcpEmbeddedInput(state, { kind: "mouse", action: "move", x: p.x, y: p.y });
  });
  stage.addEventListener(
    "wheel",
    (ev) => {
      if (!isInteractive()) {
        return;
      }
      ev.preventDefault();
      const p = embeddedPopupPoint(ev, stage, currentFlow()!.viewport);
      void sendMcpEmbeddedInput(state, {
        kind: "wheel",
        x: p.x,
        y: p.y,
        deltaX: Math.round(ev.deltaX),
        deltaY: Math.round(ev.deltaY),
      });
    },
    { passive: false },
  );
  stage.addEventListener("keydown", (ev) => {
    if (!isInteractive()) {
      return;
    }
    const special = mapEmbeddedSpecialKey(ev.key);
    if (special) {
      ev.preventDefault();
      void sendMcpEmbeddedInput(state, { kind: "key", action: "press", key: special });
    } else if (ev.key.length === 1 && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
      ev.preventDefault();
      void sendMcpEmbeddedInput(state, { kind: "key", action: "type", text: ev.key });
    }
  });
  stage.addEventListener("paste", (ev) => {
    if (!isInteractive()) {
      return;
    }
    const text = ev.clipboardData?.getData("text");
    if (text) {
      ev.preventDefault();
      void sendMcpEmbeddedInput(state, { kind: "key", action: "type", text });
    }
  });

  stage.focus();
  return popup;
}

/**
 * Start a server-side headless-browser (embedded) OAuth flow. Returns
 * `{ unavailable: true }` when the gateway cannot run a headless browser so the
 * caller can fall back to the popup flow.
 */
export async function startMcpOAuthEmbedded(
  state: McpState,
  name: string,
  scopes?: string[],
): Promise<{ ok: boolean; unavailable?: boolean }> {
  if (!state.client || !state.connected) {
    return { ok: false };
  }
  cancelMcpOAuthEmbedded(state);
  try {
    const res = await state.client.request<McpEmbeddedStartResult>("mcp.oauth.embedded.start", {
      name,
      scopes,
    });
    state.mcpEmbeddedFlow = {
      name,
      sessionId: res.sessionId,
      viewport: res.viewport,
      phase: "loading",
      frame: null,
      seq: 0,
      providerName: res.providerName,
    };
    const popup = openEmbeddedPopup(state, state.mcpEmbeddedFlow);
    if (!popup) {
      // Popup blocked: tear down the server-side session we just started and
      // signal the caller to fall back to the real-browser popup flow.
      cancelMcpOAuthEmbedded(state);
      return { ok: false, unavailable: true };
    }
    state.mcpEmbeddedPopup = popup;
    scheduleEmbeddedPoll(state, 0);
    return { ok: true };
  } catch {
    // Any start failure means the embedded path is not usable right now; signal
    // the caller to fall back to the popup flow.
    return { ok: false, unavailable: true };
  }
}

function scheduleEmbeddedPoll(state: McpState, delayMs: number) {
  stopEmbeddedPoll(state);
  state.mcpEmbeddedPollTimer = setTimeout(() => {
    void pollMcpEmbeddedOnce(state);
  }, delayMs);
}

async function pollMcpEmbeddedOnce(state: McpState) {
  const flow = state.mcpEmbeddedFlow;
  if (!flow || !state.client || !state.connected) {
    return;
  }
  if (state.mcpEmbeddedPopup?.closed) {
    // The user closed the popup window directly; treat it the same as
    // clicking the inline Cancel button.
    cancelMcpOAuthEmbedded(state);
    return;
  }
  try {
    const res = await state.client.request<McpEmbeddedPollResult>("mcp.oauth.embedded.poll", {
      sessionId: flow.sessionId,
    });
    // The flow may have been cancelled/replaced while the request was in flight.
    if (state.mcpEmbeddedFlow?.sessionId !== flow.sessionId) {
      return;
    }
    state.mcpEmbeddedFlow = {
      ...flow,
      phase: res.phase,
      seq: res.seq,
      frame: res.frame ?? flow.frame,
      providerName: res.providerName ?? flow.providerName,
      message: res.message,
    };
    updateEmbeddedPopup(state);
    if (res.phase === "done") {
      stopEmbeddedPoll(state);
      state.mcpOAuthStatus = {
        ...state.mcpOAuthStatus,
        [flow.name]: {
          connected: true,
          requiresAuth: false,
          providerName: res.providerName ?? flow.providerName,
          expiresAtMs: res.expiresAtMs ?? null,
        },
      };
      state.mcpMessage = { kind: "success", text: `Connected to "${flow.name}".` };
      state.mcpEmbeddedFlow = null;
      scheduleEmbeddedPopupClose(state, EMBEDDED_POPUP_CLOSE_DELAY_OK_MS);
      return;
    }
    if (res.phase === "error") {
      stopEmbeddedPoll(state);
      state.mcpMessage = {
        kind: "error",
        text: res.message ?? "Embedded OAuth failed.",
      };
      state.mcpEmbeddedFlow = null;
      scheduleEmbeddedPopupClose(state, EMBEDDED_POPUP_CLOSE_DELAY_ERROR_MS);
      return;
    }
    scheduleEmbeddedPoll(state, EMBEDDED_POLL_INTERVAL_MS);
  } catch (err) {
    if (state.mcpEmbeddedFlow?.sessionId !== flow.sessionId) {
      return;
    }
    stopEmbeddedPoll(state);
    state.mcpMessage = { kind: "error", text: `Embedded OAuth failed: ${getErrorMessage(err)}` };
    state.mcpEmbeddedFlow = null;
    closeEmbeddedPopup(state);
  }
}

/** Relay a pointer/keyboard event into the embedded headless browser. */
export async function sendMcpEmbeddedInput(state: McpState, ev: McpEmbeddedInput) {
  const flow = state.mcpEmbeddedFlow;
  if (!flow || !state.client || !state.connected || flow.phase !== "interactive") {
    return;
  }
  try {
    await state.client.request("mcp.oauth.embedded.input", { sessionId: flow.sessionId, ...ev });
  } catch {
    // Best effort; the next poll surfaces any terminal error.
  }
}

/** Cancel and tear down the active embedded OAuth flow. */
export function cancelMcpOAuthEmbedded(state: McpState) {
  stopEmbeddedPoll(state);
  const flow = state.mcpEmbeddedFlow;
  state.mcpEmbeddedFlow = null;
  closeEmbeddedPopup(state);
  if (flow && state.client && state.connected) {
    void state.client
      .request("mcp.oauth.embedded.cancel", { sessionId: flow.sessionId })
      .catch(() => {});
  }
}

export async function disconnectMcpOAuth(state: McpState, name: string) {
  if (!state.client || !state.connected) {
    return;
  }
  try {
    await state.client.request("mcp.oauth.disconnect", { name });
    state.mcpOAuthStatus = {
      ...state.mcpOAuthStatus,
      [name]: { connected: false, requiresAuth: false },
    };
    state.mcpMessage = { kind: "success", text: `Disconnected "${name}".` };
  } catch (err) {
    state.mcpMessage = { kind: "error", text: getErrorMessage(err) };
  }
}

export function cancelMcpOAuth(state: McpState) {
  if (state.mcpOAuthPopup && !state.mcpOAuthPopup.closed) {
    try {
      state.mcpOAuthPopup.close();
    } catch {
      // ignore
    }
  }
  state.mcpOAuthPopup = null;
  state.mcpOAuthFlow = null;
}
