import { isReadHttpMethod } from "./control-ui-http-utils.js";
import { CONTROL_UI_AVATAR_PREFIX, normalizeControlUiBasePath } from "./control-ui-shared.js";

export const CONTROL_UI_ASSISTANT_MEDIA_PREFIX = "/__genesis__/assistant-media";
export const CONTROL_UI_ASSISTANT_MEDIA_TOKEN_PREFIX = "/__genesis__/assistant-media-token";
export const CONTROL_UI_CANVAS_UPLOAD_PREFIX = "/__genesis__/canvas-upload";

export type ControlUiRequestClassification =
  | { kind: "not-control-ui" }
  | { kind: "not-found" }
  | { kind: "redirect"; location: string }
  | { kind: "serve" };

const ROOT_MOUNTED_GATEWAY_PROBE_PATHS = new Set(["/health", "/healthz", "/ready", "/readyz"]);

export function classifyControlUiRequest(params: {
  basePath: string;
  pathname: string;
  search: string;
  method: string | undefined;
}): ControlUiRequestClassification {
  const { basePath, pathname, search, method } = params;
  if (!basePath) {
    if (pathname === "/ui" || pathname.startsWith("/ui/")) {
      return { kind: "not-found" };
    }
    // Keep core probe routes outside the root-mounted SPA catch-all so the
    // gateway probe handler can answer them even when the Control UI owns `/`.
    if (ROOT_MOUNTED_GATEWAY_PROBE_PATHS.has(pathname)) {
      return { kind: "not-control-ui" };
    }
    // Keep plugin-owned HTTP routes outside the root-mounted Control UI SPA
    // fallback so untrusted plugins cannot claim arbitrary UI paths.
    if (pathname === "/plugins" || pathname.startsWith("/plugins/")) {
      return { kind: "not-control-ui" };
    }
    if (pathname === "/api" || pathname.startsWith("/api/")) {
      return { kind: "not-control-ui" };
    }
    if (!isReadHttpMethod(method)) {
      return { kind: "not-control-ui" };
    }
    return { kind: "serve" };
  }

  if (!pathname.startsWith(`${basePath}/`) && pathname !== basePath) {
    return { kind: "not-control-ui" };
  }
  if (!isReadHttpMethod(method)) {
    return { kind: "not-control-ui" };
  }
  if (pathname === basePath) {
    return { kind: "redirect", location: `${basePath}/${search}` };
  }
  return { kind: "serve" };
}

/**
 * True when the Control UI runtime could claim this request. Callers gate the
 * lazy `control-ui.js` import on it so unrelated HTTP traffic (plugin webhooks,
 * `/api/*`, probes) never pays the cold-load cost of the dashboard module.
 * Must stay a superset of what the Control UI request handlers accept.
 */
export function isControlUiOwnedRequest(params: {
  basePath: string | undefined;
  pathname: string;
  search: string;
  method: string | undefined;
}): boolean {
  const basePath = normalizeControlUiBasePath(params.basePath);
  const { pathname } = params;
  if (
    pathname === `${basePath}${CONTROL_UI_ASSISTANT_MEDIA_PREFIX}` ||
    pathname === `${basePath}${CONTROL_UI_ASSISTANT_MEDIA_TOKEN_PREFIX}` ||
    pathname === `${basePath}${CONTROL_UI_CANVAS_UPLOAD_PREFIX}`
  ) {
    return true;
  }
  if (pathname.startsWith(`${basePath}${CONTROL_UI_AVATAR_PREFIX}/`)) {
    return true;
  }
  return (
    classifyControlUiRequest({
      basePath,
      pathname,
      search: params.search,
      method: params.method,
    }).kind !== "not-control-ui"
  );
}
