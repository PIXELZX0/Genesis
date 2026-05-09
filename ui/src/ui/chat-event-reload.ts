import type { ChatEventPayload } from "./controllers/chat.ts";

export function shouldReloadHistoryForFinalEvent(payload?: ChatEventPayload): boolean {
  if (!payload || payload.state !== "final") {
    return false;
  }
  const message = payload.message;
  if (!message || typeof message !== "object") {
    return true;
  }
  const role = (message as { role?: unknown }).role;
  return typeof role !== "string" || role.trim().toLowerCase() !== "assistant";
}
