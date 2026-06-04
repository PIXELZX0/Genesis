import { normalizeLowercaseStringOrEmpty } from "./string-coerce.ts";

const DATA_URL_PREFIX = "data:";
const ALLOWED_EXTERNAL_PROTOCOLS = new Set(["http:", "https:", "blob:"]);
const BLOCKED_DATA_IMAGE_MIME_TYPES = new Set(["image/svg+xml"]);

function isAllowedDataImageUrl(url: string): boolean {
  if (!normalizeLowercaseStringOrEmpty(url).startsWith(DATA_URL_PREFIX)) {
    return false;
  }

  const commaIndex = url.indexOf(",");
  if (commaIndex < DATA_URL_PREFIX.length) {
    return false;
  }

  const metadata = url.slice(DATA_URL_PREFIX.length, commaIndex);
  const mimeType = normalizeLowercaseStringOrEmpty(metadata.split(";")[0]);
  if (!mimeType.startsWith("image/")) {
    return false;
  }

  return !BLOCKED_DATA_IMAGE_MIME_TYPES.has(mimeType);
}

export type ResolveSafeExternalUrlOptions = {
  allowDataImage?: boolean;
};

export function resolveSafeExternalUrl(
  rawUrl: string,
  baseHref: string,
  opts: ResolveSafeExternalUrlOptions = {},
): string | null {
  const candidate = rawUrl.trim();
  if (!candidate) {
    return null;
  }

  if (opts.allowDataImage === true && isAllowedDataImageUrl(candidate)) {
    return candidate;
  }

  if (normalizeLowercaseStringOrEmpty(candidate).startsWith(DATA_URL_PREFIX)) {
    return null;
  }

  try {
    const parsed = new URL(candidate, baseHref);
    return ALLOWED_EXTERNAL_PROTOCOLS.has(normalizeLowercaseStringOrEmpty(parsed.protocol))
      ? parsed.toString()
      : null;
  } catch {
    return null;
  }
}

export type OpenExternalUrlSafeOptions = ResolveSafeExternalUrlOptions & {
  baseHref?: string;
};

export function openExternalUrlSafe(
  rawUrl: string,
  opts: OpenExternalUrlSafeOptions = {},
): WindowProxy | null {
  const baseHref = opts.baseHref ?? window.location.href;
  const safeUrl = resolveSafeExternalUrl(rawUrl, baseHref, opts);
  if (!safeUrl) {
    return null;
  }

  const opened = window.open(safeUrl, "_blank", "noopener,noreferrer");
  if (opened) {
    opened.opener = null;
  }
  return opened;
}

export type OpenPopupWindowSafeOptions = ResolveSafeExternalUrlOptions & {
  baseHref?: string;
};

/**
 * Open a named popup window for a trusted interactive flow (e.g. the MCP OAuth
 * authorization popup) while applying the same URL-scheme safety checks as
 * {@link openExternalUrlSafe}.
 *
 * Unlike {@link openExternalUrlSafe}, this preserves the returned window handle
 * and its live `opener` link: the OAuth callback page posts its result back via
 * `window.opener.postMessage`, and the caller keeps the handle to size, close,
 * or identity-check the popup. Pass `target` (named window) and `features`
 * (e.g. sizing plus `noopener=no`) exactly as you would to `window.open`.
 */
export function openPopupWindowSafe(
  rawUrl: string,
  target: string,
  features: string,
  opts: OpenPopupWindowSafeOptions = {},
): WindowProxy | null {
  const baseHref = opts.baseHref ?? window.location.href;
  const safeUrl = resolveSafeExternalUrl(rawUrl, baseHref, opts);
  if (!safeUrl) {
    return null;
  }
  return window.open(safeUrl, target, features);
}
