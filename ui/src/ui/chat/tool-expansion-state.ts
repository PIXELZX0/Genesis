import { getOrCreateSessionCacheValue } from "./session-cache.ts";

// Per-session expansion state for collapsible turn work blocks (thinking + tool use).
// Keyed by disclosure id (e.g. `work:${groupKey}`). Absent ⇒ collapsed by default,
// matching the Claude Desktop style where steps stay folded until clicked.
const expandedToolCardsBySession = new Map<string, Map<string, boolean>>();

export function getExpandedToolCards(sessionKey: string): Map<string, boolean> {
  return getOrCreateSessionCacheValue(expandedToolCardsBySession, sessionKey, () => new Map());
}

export function resetToolExpansionStateForTest() {
  expandedToolCardsBySession.clear();
}
