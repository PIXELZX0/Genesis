/**
 * Short-lived, media-read-only capability tokens for the assistant-media route.
 *
 * `<img>`/`<audio>`/`<video>` elements can only carry a credential in the URL,
 * and URLs leak (proxy access logs, browser history, Referer). These tokens keep
 * that leak scoped: they authorize reads of the assistant-media route only, and
 * they expire, unlike the shared gateway operator token.
 */

import { randomBytes } from "node:crypto";

export const ASSISTANT_MEDIA_CAPABILITY_QUERY_PARAM = "mt";
export const ASSISTANT_MEDIA_CAPABILITY_TTL_MS = 10 * 60_000;

const capabilities = new Map<string, number>();

function pruneExpired(now: number): void {
  for (const [token, expiresAt] of capabilities) {
    if (expiresAt <= now) {
      capabilities.delete(token);
    }
  }
}

export function mintAssistantMediaCapability(): { token: string; expiresInMs: number } {
  const now = Date.now();
  pruneExpired(now);
  const token = randomBytes(18).toString("base64url");
  capabilities.set(token, now + ASSISTANT_MEDIA_CAPABILITY_TTL_MS);
  return { token, expiresInMs: ASSISTANT_MEDIA_CAPABILITY_TTL_MS };
}

export function verifyAssistantMediaCapability(token: string | undefined): boolean {
  const trimmed = token?.trim();
  if (!trimmed) {
    return false;
  }
  const expiresAt = capabilities.get(trimmed);
  if (expiresAt === undefined) {
    return false;
  }
  if (expiresAt <= Date.now()) {
    capabilities.delete(trimmed);
    return false;
  }
  return true;
}

export function __resetAssistantMediaCapabilitiesForTest(): void {
  capabilities.clear();
}
