import type { GatewayBrowserClient } from "./gateway.ts";

const CANVAS_AGENT_RUN_TYPE = "genesis:canvas:agent-run-request";
const CANVAS_HOST_PATH = "/__genesis__/canvas";
const CANVAS_CAPABILITY_PATH_PREFIX = "/__genesis__/cap";

export type CanvasAgentRunHost = {
  connected: boolean;
  client: GatewayBrowserClient | null;
  sessionKey: string;
  lastError?: string | null;
  handleSendChat: (messageOverride?: string) => Promise<void>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function coerceCanvasAgentRunRequest(
  value: unknown,
): { message: string; context?: unknown } | null {
  if (!isRecord(value) || value.type !== CANVAS_AGENT_RUN_TYPE) {
    return null;
  }
  const message = typeof value.message === "string" ? value.message.trim() : "";
  if (!message) {
    return null;
  }
  return {
    message,
    ...("context" in value ? { context: value.context } : {}),
  };
}

function isCanvasPath(pathname: string): boolean {
  if (pathname === CANVAS_HOST_PATH || pathname.startsWith(`${CANVAS_HOST_PATH}/`)) {
    return true;
  }
  if (!pathname.startsWith(`${CANVAS_CAPABILITY_PATH_PREFIX}/`)) {
    return false;
  }
  const marker = `${CANVAS_HOST_PATH}/`;
  return pathname.includes(marker) || pathname.endsWith(CANVAS_HOST_PATH);
}

export function isTrustedCanvasMessageSource(
  source: MessageEventSource | null,
  root: ParentNode = document,
): boolean {
  if (!source) {
    return false;
  }
  const frames = Array.from(root.querySelectorAll<HTMLIFrameElement>("iframe"));
  return frames.some((frame) => {
    if (frame.contentWindow !== source) {
      return false;
    }
    const rawSrc = frame.getAttribute("src")?.trim();
    if (!rawSrc) {
      return false;
    }
    try {
      const src = new URL(rawSrc, window.location.href);
      return isCanvasPath(src.pathname);
    } catch {
      return false;
    }
  });
}

export async function handleCanvasAgentRunMessage(
  host: CanvasAgentRunHost,
  event: MessageEvent,
  opts?: {
    confirm?: (message: string) => boolean;
    root?: ParentNode;
  },
): Promise<boolean> {
  const request = coerceCanvasAgentRunRequest(event.data);
  if (!request || !isTrustedCanvasMessageSource(event.source, opts?.root ?? document)) {
    return false;
  }
  if (!host.connected || !host.client) {
    host.lastError = "Gateway not connected";
    return true;
  }
  const confirmFn = opts?.confirm ?? window.confirm.bind(window);
  const confirmed = confirmFn(
    `Canvas wants to send this to Genesis:\n\n${request.message}\n\nSend it now?`,
  );
  if (!confirmed) {
    return true;
  }
  await host.handleSendChat(request.message);
  return true;
}
