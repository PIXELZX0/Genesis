import { resetToolStream } from "../app-tool-stream.ts";
import { extractText } from "../chat/message-extract.ts";
import { formatConnectError } from "../connect-error.ts";
import { GatewayRequestError, type GatewayBrowserClient } from "../gateway.ts";
import { normalizeLowercaseStringOrEmpty } from "../string-coerce.ts";
import type { ChatAttachment } from "../ui-types.ts";
import { generateUUID } from "../uuid.ts";
import {
  formatMissingOperatorReadScopeMessage,
  isMissingOperatorReadScopeError,
} from "./scope-errors.ts";

const SILENT_REPLY_PATTERN = /^\s*NO_REPLY\s*$/;
const HEARTBEAT_TOKEN = "HEARTBEAT_OK";
const DEFAULT_HEARTBEAT_ACK_MAX_CHARS = 300;
const SYNTHETIC_TRANSCRIPT_REPAIR_RESULT =
  "[genesis] missing tool result in session history; inserted synthetic error result for transcript repair.";
const STARTUP_CHAT_HISTORY_RETRY_TIMEOUT_MS = 60_000;
const STARTUP_CHAT_HISTORY_DEFAULT_RETRY_MS = 500;
const STARTUP_CHAT_HISTORY_MAX_RETRY_MS = 5_000;
type ChatHistoryStaleResult = "stale" | "run-stale";
type ChatHistoryInvalidationReason = "generic" | "run";
const chatHistoryRequestVersions = new WeakMap<object, number>();
const chatHistoryInvalidationResults = new WeakMap<object, Map<number, ChatHistoryStaleResult>>();
const MAX_CHAT_HISTORY_INVALIDATION_RESULTS = 256;
const handledTerminalChatEvents = new WeakMap<object, Map<string, number>>();
const MAX_HANDLED_TERMINAL_CHAT_EVENTS = 256;

function recordChatHistoryInvalidation(
  state: ChatState,
  version: number,
  result: ChatHistoryStaleResult,
): void {
  const key = state as object;
  let results = chatHistoryInvalidationResults.get(key);
  if (!results) {
    results = new Map();
    chatHistoryInvalidationResults.set(key, results);
  }
  results.set(version, result);
  while (results.size > MAX_CHAT_HISTORY_INVALIDATION_RESULTS) {
    const oldestVersion = results.keys().next().value;
    if (typeof oldestVersion !== "number") {
      break;
    }
    results.delete(oldestVersion);
  }
}

function advanceChatHistoryRequest(state: ChatState, staleResult: ChatHistoryStaleResult): number {
  const key = state as object;
  const currentVersion = chatHistoryRequestVersions.get(key);
  if (currentVersion !== undefined) {
    recordChatHistoryInvalidation(state, currentVersion, staleResult);
  }
  const nextVersion = (currentVersion ?? 0) + 1;
  chatHistoryRequestVersions.set(key, nextVersion);
  return nextVersion;
}

function beginChatHistoryRequest(state: ChatState): number {
  return advanceChatHistoryRequest(state, "stale");
}

function isLatestChatHistoryRequest(state: ChatState, version: number): boolean {
  return chatHistoryRequestVersions.get(state as object) === version;
}

function resolveChatHistoryStaleResult(state: ChatState, version: number): ChatHistoryStaleResult {
  return chatHistoryInvalidationResults.get(state as object)?.get(version) ?? "stale";
}

export function invalidateChatHistoryRequests(
  state: ChatState,
  reason: ChatHistoryInvalidationReason = "generic",
): void {
  advanceChatHistoryRequest(state, reason === "run" ? "run-stale" : "stale");
  state.chatLoading = false;
}

function shouldApplyChatHistoryResult(
  state: ChatState,
  version: number,
  sessionKey: string,
): boolean {
  return isLatestChatHistoryRequest(state, version) && state.sessionKey === sessionKey;
}

function isSilentReplyStream(text: string): boolean {
  return SILENT_REPLY_PATTERN.test(text);
}

function isTerminalChatEventState(state: ChatEventPayload["state"]): boolean {
  return state === "final" || state === "aborted" || state === "error";
}

function terminalChatEventKey(payload: ChatEventPayload): string | null {
  if (!isTerminalChatEventState(payload.state)) {
    return null;
  }
  const runId = typeof payload.runId === "string" ? payload.runId.trim() : "";
  const sessionKey = typeof payload.sessionKey === "string" ? payload.sessionKey.trim() : "";
  return runId && sessionKey ? `${sessionKey}\u0000${runId}` : null;
}

function hasHandledTerminalChatEvent(state: ChatState, payload: ChatEventPayload): boolean {
  const key = terminalChatEventKey(payload);
  if (!key) {
    return false;
  }
  return handledTerminalChatEvents.get(state as object)?.has(key) ?? false;
}

function markTerminalChatEventHandled(state: ChatState, payload: ChatEventPayload): void {
  const key = terminalChatEventKey(payload);
  if (!key) {
    return;
  }
  const stateKey = state as object;
  let events = handledTerminalChatEvents.get(stateKey);
  if (!events) {
    events = new Map();
    handledTerminalChatEvents.set(stateKey, events);
  }
  events.set(key, Date.now());
  while (events.size > MAX_HANDLED_TERMINAL_CHAT_EVENTS) {
    const oldestKey = events.keys().next().value;
    if (typeof oldestKey !== "string") {
      break;
    }
    events.delete(oldestKey);
  }
}

// RAF coalescing for streaming delta updates — collapses N chunks per frame into one
// Lit reactive write. Terminal states (final/aborted/error) flush before clearing.
let streamRaf: number | null = null;
let streamPending: { state: ChatState; text: string } | null = null;

function applyPendingStream(): void {
  if (streamPending) {
    const { state, text } = streamPending;
    streamPending = null;
    state.chatStream = text;
  }
}

/** Cancel any pending RAF and apply the buffered stream value synchronously. Exposed for tests. */
export function flushPendingStream(): void {
  if (streamRaf !== null) {
    cancelAnimationFrame(streamRaf);
    streamRaf = null;
  }
  applyPendingStream();
}

/** Cancel a buffered stream update without applying text from the previous run. */
export function cancelPendingStream(): void {
  if (streamRaf !== null) {
    cancelAnimationFrame(streamRaf);
    streamRaf = null;
  }
  streamPending = null;
}

function scheduleStreamUpdate(state: ChatState, text: string): void {
  streamPending = { state, text };
  if (streamRaf === null) {
    streamRaf = requestAnimationFrame(() => {
      streamRaf = null;
      applyPendingStream();
    });
  }
}

/**
 * Latest streamed text for a state, accounting for an update buffered in the
 * pending RAF that has not yet been written to `state.chatStream`. Used to
 * accumulate incremental `appendText` deltas without losing a coalesced chunk.
 */
function currentStreamText(state: ChatState): string {
  if (streamPending && streamPending.state === state) {
    return streamPending.text;
  }
  return state.chatStream ?? "";
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripHeartbeatTokenForDisplay(
  raw: string,
  maxAckChars = DEFAULT_HEARTBEAT_ACK_MAX_CHARS,
): { shouldSkip: boolean } {
  let text = raw.trim();
  if (!text) {
    return { shouldSkip: true };
  }
  const strippedMarkup = text
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/^[*`~_]+/, "")
    .replace(/[*`~_]+$/, "");
  if (!text.includes(HEARTBEAT_TOKEN) && !strippedMarkup.includes(HEARTBEAT_TOKEN)) {
    return { shouldSkip: false };
  }

  const tokenAtEnd = new RegExp(`${escapeRegExp(HEARTBEAT_TOKEN)}[^\\w]{0,4}$`);
  let changed = true;
  let didStrip = false;
  text = strippedMarkup.trim();
  while (changed) {
    changed = false;
    const next = text.trim();
    if (next.startsWith(HEARTBEAT_TOKEN)) {
      text = next.slice(HEARTBEAT_TOKEN.length).trimStart();
      didStrip = true;
      changed = true;
      continue;
    }
    if (tokenAtEnd.test(next)) {
      const index = next.lastIndexOf(HEARTBEAT_TOKEN);
      const before = next.slice(0, index).trimEnd();
      const after = next.slice(index + HEARTBEAT_TOKEN.length).trimStart();
      text = before ? `${before}${after}`.trimEnd() : "";
      didStrip = true;
      changed = true;
    }
  }

  if (!didStrip) {
    return { shouldSkip: false };
  }
  return { shouldSkip: !text || text.length <= maxAckChars };
}

function isHeartbeatOkResponse(message: { role: string; content?: unknown }): boolean {
  if (message.role !== "assistant") {
    return false;
  }
  const { text, hasNonTextContent } = resolveMessageText(message.content);
  if (hasNonTextContent) {
    return false;
  }
  return stripHeartbeatTokenForDisplay(text).shouldSkip;
}

function resolveMessageText(content: unknown): { text: string; hasNonTextContent: boolean } {
  if (typeof content === "string") {
    return { text: content, hasNonTextContent: false };
  }
  if (!Array.isArray(content)) {
    return { text: "", hasNonTextContent: content != null };
  }
  let hasNonTextContent = false;
  const text = content
    .filter((block): block is { type: "text"; text: string } => {
      if (!block || typeof block !== "object" || !("type" in block)) {
        hasNonTextContent = true;
        return false;
      }
      if ((block as { type?: unknown }).type !== "text") {
        hasNonTextContent = true;
        return false;
      }
      if (typeof (block as { text?: unknown }).text !== "string") {
        hasNonTextContent = true;
        return false;
      }
      return true;
    })
    .map((block) => block.text)
    .join("");
  return { text, hasNonTextContent };
}

/** Client-side defense-in-depth: detect assistant messages whose text is purely NO_REPLY. */
function isAssistantSilentReply(message: unknown): boolean {
  if (!message || typeof message !== "object") {
    return false;
  }
  const entry = message as Record<string, unknown>;
  const role = normalizeLowercaseStringOrEmpty(entry.role);
  if (role !== "assistant") {
    return false;
  }
  // entry.text takes precedence — matches gateway extractAssistantTextForSilentCheck
  if (typeof entry.text === "string") {
    return isSilentReplyStream(entry.text);
  }
  const text = extractText(message);
  return typeof text === "string" && isSilentReplyStream(text);
}

function isSyntheticTranscriptRepairToolResult(message: unknown): boolean {
  if (!message || typeof message !== "object") {
    return false;
  }
  const entry = message as Record<string, unknown>;
  const role = normalizeLowercaseStringOrEmpty(entry.role);
  if (role !== "toolresult") {
    return false;
  }
  const text = extractText(message);
  return typeof text === "string" && text.trim() === SYNTHETIC_TRANSCRIPT_REPAIR_RESULT;
}

function isTextOnlyContent(content: unknown): boolean {
  if (typeof content === "string") {
    return true;
  }
  if (!Array.isArray(content)) {
    return false;
  }
  if (content.length === 0) {
    return true;
  }
  let sawText = false;
  for (const block of content) {
    if (!block || typeof block !== "object") {
      return false;
    }
    const entry = block as { type?: unknown; text?: unknown };
    if (entry.type !== "text") {
      return false;
    }
    sawText = true;
    if (typeof entry.text !== "string") {
      return false;
    }
  }
  return sawText;
}

function isEmptyUserTextOnlyMessage(message: unknown): boolean {
  if (!message || typeof message !== "object") {
    return false;
  }
  const entry = message as Record<string, unknown>;
  if (normalizeLowercaseStringOrEmpty(entry.role) !== "user") {
    return false;
  }
  if (hasMediaPathPresence(entry)) {
    return false;
  }
  if (!isTextOnlyContent(entry.content ?? entry.text)) {
    return false;
  }
  return (extractText(message)?.trim() ?? "") === "";
}

function isAssistantHeartbeatAck(message: unknown): boolean {
  if (!message || typeof message !== "object") {
    return false;
  }
  const entry = message as Record<string, unknown>;
  const role = normalizeLowercaseStringOrEmpty(entry.role);
  if (role !== "assistant") {
    return false;
  }
  const content = entry.content ?? entry.text;
  return isHeartbeatOkResponse({ role, content });
}

function shouldHideHistoryMessage(message: unknown): boolean {
  return (
    isAssistantSilentReply(message) ||
    isAssistantHeartbeatAck(message) ||
    isSyntheticTranscriptRepairToolResult(message) ||
    isEmptyUserTextOnlyMessage(message)
  );
}

function hasTranscriptMeta(message: unknown): boolean {
  return Boolean(
    message &&
    typeof message === "object" &&
    (message as { __genesis?: unknown }).__genesis &&
    typeof (message as { __genesis?: unknown }).__genesis === "object",
  );
}

function isLocallyOptimisticHistoryMessage(message: unknown): boolean {
  if (!message || typeof message !== "object" || hasTranscriptMeta(message)) {
    return false;
  }
  const role = normalizeLowercaseStringOrEmpty((message as { role?: unknown }).role);
  return role === "user" || role === "assistant";
}

function messageDisplaySignature(message: unknown): string | null {
  if (!message || typeof message !== "object") {
    return null;
  }
  const role = normalizeLowercaseStringOrEmpty((message as { role?: unknown }).role);
  if (!role) {
    return null;
  }
  const text = extractText(message)?.trim();
  const mediaSignature = messageMediaSignature(message);
  if (text && mediaSignature) {
    return `${role}:text:${text}|${mediaSignature}`;
  }
  if (mediaSignature) {
    return mediaSignature;
  }
  if (text) {
    return `${role}:text:${text}`;
  }
  try {
    const content = JSON.stringify((message as { content?: unknown }).content ?? null);
    return `${role}:content:${content}`;
  } catch {
    return null;
  }
}

function readTranscriptMessageMeta(message: unknown): Record<string, unknown> | null {
  if (!message || typeof message !== "object") {
    return null;
  }
  const meta = (message as { __genesis?: unknown }).__genesis;
  return meta && typeof meta === "object" && !Array.isArray(meta)
    ? (meta as Record<string, unknown>)
    : null;
}

function transcriptMessageIdentity(message: unknown): string | null {
  const meta = readTranscriptMessageMeta(message);
  const id = meta?.id;
  if (typeof id === "string" && id.trim()) {
    return `id:${id.trim()}`;
  }
  const seq = meta?.seq;
  if (typeof seq === "number" && Number.isFinite(seq)) {
    return `seq:${seq}`;
  }
  return null;
}

function normalizeMediaType(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  return normalized || null;
}

function readMediaValues(
  entry: Record<string, unknown>,
  pluralKey: string,
  singularKey: string,
): string[] {
  if (Array.isArray(entry[pluralKey])) {
    return entry[pluralKey].filter((value): value is string => typeof value === "string");
  }
  return typeof entry[singularKey] === "string" ? [entry[singularKey]] : [];
}

const TRANSCRIPT_IMAGE_MIME_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  svg: "image/svg+xml",
  heic: "image/heic",
  heif: "image/heif",
  avif: "image/avif",
};

function inferTranscriptImageMimeType(value: string): string | null {
  let source = value.trim();
  try {
    const parsed = new URL(source);
    if (parsed.pathname) {
      source = parsed.pathname;
    }
  } catch {
    // Treat non-URL values as local paths.
  }
  const fileName = (source.split(/[?#]/, 1)[0] ?? source).split(/[\\/]/).pop() ?? source;
  const extension = /\.([a-z0-9]+)$/i.exec(fileName)?.[1]?.toLowerCase();
  return extension ? (TRANSCRIPT_IMAGE_MIME_TYPES[extension] ?? null) : null;
}

function hasMediaPathPresence(entry: Record<string, unknown>): boolean {
  const hasNonEmptyString = (value: unknown): boolean =>
    typeof value === "string" && value.trim().length > 0;
  return (
    hasNonEmptyString(entry.MediaPath) ||
    hasNonEmptyString(entry.MediaUrl) ||
    (Array.isArray(entry.MediaPaths) && entry.MediaPaths.some(hasNonEmptyString)) ||
    (Array.isArray(entry.MediaUrls) && entry.MediaUrls.some(hasNonEmptyString))
  );
}

function readTranscriptMediaSources(entry: Record<string, unknown>): string[] {
  const paths = readMediaValues(entry, "MediaPaths", "MediaPath").filter((path) => path.trim());
  if (paths.length > 0) {
    return paths;
  }
  return readMediaValues(entry, "MediaUrls", "MediaUrl").filter((url) => url.trim());
}

function buildMediaSignature(count: number, mediaTypes: string[]): string | null {
  if (count === 0 || mediaTypes.length === 0) {
    return null;
  }
  return `user:media:${count}:${mediaTypes.join("|")}`;
}

function transcriptMediaSignature(entry: Record<string, unknown>): string | null {
  const mediaSources = readTranscriptMediaSources(entry);
  const explicitMediaTypes = readMediaValues(entry, "MediaTypes", "MediaType")
    .map(normalizeMediaType)
    .filter((mediaType): mediaType is string => Boolean(mediaType));
  const mediaTypes = mediaSources.map((source, index) => {
    const explicitMediaType = explicitMediaTypes[index];
    if (explicitMediaType && explicitMediaType !== "application/octet-stream") {
      return explicitMediaType;
    }
    return inferTranscriptImageMimeType(source);
  });
  if (mediaTypes.some((mediaType) => !mediaType)) {
    return null;
  }
  return buildMediaSignature(
    mediaSources.length,
    mediaTypes.filter((mediaType): mediaType is string => Boolean(mediaType)),
  );
}

function optimisticMediaSignature(entry: Record<string, unknown>): string | null {
  const content = entry.content;
  if (!Array.isArray(content) || content.length === 0) {
    return null;
  }
  const mediaTypes: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") {
      return null;
    }
    const blockEntry = block as Record<string, unknown>;
    if (blockEntry.type === "text") {
      if (typeof blockEntry.text !== "string") {
        return null;
      }
      continue;
    }
    if (blockEntry.type !== "image") {
      return null;
    }
    const source = blockEntry.source;
    const sourceEntry =
      source && typeof source === "object" ? (source as Record<string, unknown>) : null;
    const mediaType = normalizeMediaType(sourceEntry?.media_type ?? blockEntry.mimeType);
    if (!mediaType) {
      return null;
    }
    mediaTypes.push(mediaType);
  }
  return buildMediaSignature(mediaTypes.length, mediaTypes);
}

function messageMediaSignature(message: unknown): string | null {
  if (!message || typeof message !== "object") {
    return null;
  }
  const entry = message as Record<string, unknown>;
  if (normalizeLowercaseStringOrEmpty(entry.role) !== "user") {
    return null;
  }
  return transcriptMediaSignature(entry) ?? optimisticMediaSignature(entry);
}

function isProvisionalUserTranscriptMessage(message: unknown): boolean {
  if (!message || typeof message !== "object") {
    return false;
  }
  if (normalizeLowercaseStringOrEmpty((message as { role?: unknown }).role) !== "user") {
    return false;
  }
  const meta = readTranscriptMessageMeta(message);
  if (!meta || (typeof meta.id === "string" && meta.id.trim())) {
    return false;
  }
  return typeof meta.seq === "number" && Number.isFinite(meta.seq);
}

function isPendingLocalHistoryMessage(message: unknown): boolean {
  return isLocallyOptimisticHistoryMessage(message) || isProvisionalUserTranscriptMessage(message);
}

function findMatchingHistoryMessageIndex(
  messages: unknown[],
  message: unknown,
  options?: { preferOldestOptimisticMatch?: boolean },
): number {
  const identity = transcriptMessageIdentity(message);
  if (identity) {
    const identityIndex = messages.findIndex(
      (existing) => transcriptMessageIdentity(existing) === identity,
    );
    if (identityIndex >= 0) {
      return identityIndex;
    }
  }
  const signature = messageDisplaySignature(message);
  if (!signature) {
    return -1;
  }
  const step = options?.preferOldestOptimisticMatch ? 1 : -1;
  const start = options?.preferOldestOptimisticMatch ? 0 : messages.length - 1;
  for (let index = start; index >= 0 && index < messages.length; index += step) {
    const existing = messages[index];
    if (
      !isLocallyOptimisticHistoryMessage(existing) &&
      !isProvisionalUserTranscriptMessage(existing)
    ) {
      continue;
    }
    if (messageDisplaySignature(existing) === signature) {
      return index;
    }
  }
  return -1;
}

export function applyChatHistoryMessageEvent(
  state: ChatState,
  message: unknown,
  options?: {
    appendIfMissing?: boolean;
    preferOldestOptimisticMatch?: boolean;
  },
): boolean {
  if (message === undefined || shouldHideHistoryMessage(message)) {
    return message !== undefined;
  }
  const existingIndex = findMatchingHistoryMessageIndex(state.chatMessages, message, options);
  if (existingIndex >= 0) {
    if (state.chatMessages[existingIndex] === message) {
      return true;
    }
    state.chatMessages = state.chatMessages.map((existing, index) =>
      index === existingIndex ? message : existing,
    );
    return true;
  }
  if (options?.appendIfMissing === false) {
    return false;
  }
  state.chatMessages = [...state.chatMessages, message];
  return true;
}

function preserveMessagesAddedSinceRequestStart(
  historyMessages: unknown[],
  requestStartMessages: unknown[],
  latestMessages: unknown[],
): unknown[] {
  const requestStartIdentities = new Set<string>();
  const requestStartOptimisticSignatureCounts = new Map<string, number>();
  const requestStartCanonicalIdentities = new Set<string>();
  for (const message of requestStartMessages) {
    const identity = transcriptMessageIdentity(message);
    if (identity) {
      requestStartIdentities.add(identity);
    }
    if (isPendingLocalHistoryMessage(message)) {
      const signature = messageDisplaySignature(message);
      if (signature && !identity) {
        const count = requestStartOptimisticSignatureCounts.get(signature);
        requestStartOptimisticSignatureCounts.set(signature, count ? count + 1 : 1);
      }
    }
    if (identity && !isPendingLocalHistoryMessage(message)) {
      requestStartCanonicalIdentities.add(identity);
    }
  }

  const historyIdentities = new Set<string>();
  const historySignatures = new Set<string>();
  const historySignatureCounts = new Map<string, number>();
  for (const message of historyMessages) {
    const identity = transcriptMessageIdentity(message);
    if (identity) {
      historyIdentities.add(identity);
    }
    const signature = messageDisplaySignature(message);
    if (!signature) {
      continue;
    }
    historySignatures.add(signature);
    const count = historySignatureCounts.get(signature);
    historySignatureCounts.set(signature, count ? count + 1 : 1);
  }
  const historyOverlapsRequestStart = requestStartMessages.some((message) => {
    const identity = transcriptMessageIdentity(message);
    if (identity && historyIdentities.has(identity)) {
      return true;
    }
    const signature = messageDisplaySignature(message);
    return Boolean(signature && historySignatures.has(signature));
  });

  const preservedMessages: unknown[] = [];
  for (const message of latestMessages) {
    if (shouldHideHistoryMessage(message)) {
      return historyMessages;
    }
    const identity = transcriptMessageIdentity(message);
    const signature = messageDisplaySignature(message);
    const isPendingLocalMessage = isPendingLocalHistoryMessage(message);
    if (identity && !isPendingLocalMessage) {
      if (requestStartCanonicalIdentities.has(identity) || historyIdentities.has(identity)) {
        continue;
      }
      preservedMessages.push(message);
      continue;
    }
    if (!isPendingLocalMessage) {
      return historyMessages;
    }
    if (historyMessages.length > 0 && !historyOverlapsRequestStart) {
      if (identity && requestStartIdentities.has(identity)) {
        continue;
      }
      if (!identity && signature) {
        const requestStartCount = requestStartOptimisticSignatureCounts.get(signature);
        if (requestStartCount) {
          if (requestStartCount === 1) {
            requestStartOptimisticSignatureCounts.delete(signature);
          } else {
            requestStartOptimisticSignatureCounts.set(signature, requestStartCount - 1);
          }
          continue;
        }
      }
    }
    if (identity && historyIdentities.has(identity)) {
      continue;
    }
    if (!signature) {
      return historyMessages;
    }

    const historyCount = historySignatureCounts.get(signature);
    if (historyCount) {
      if (historyCount === 1) {
        historySignatureCounts.delete(signature);
      } else {
        historySignatureCounts.set(signature, historyCount - 1);
      }
      continue;
    }
    preservedMessages.push(message);
  }

  return preservedMessages.length > 0
    ? [...historyMessages, ...preservedMessages]
    : historyMessages;
}

function preserveOptimisticTailMessages(
  historyMessages: unknown[],
  requestStartMessages: unknown[],
  previousMessages: unknown[],
): unknown[] {
  if (historyMessages.length === 0 || previousMessages.length === 0) {
    return preserveMessagesAddedSinceRequestStart(
      historyMessages,
      requestStartMessages,
      previousMessages,
    );
  }

  let sharedPreviousIndex = -1;
  let sharedHistoryIndex = -1;
  for (let previousIndex = previousMessages.length - 1; previousIndex >= 0; previousIndex--) {
    const previousMessage = previousMessages[previousIndex];
    const identity = transcriptMessageIdentity(previousMessage);
    if (!identity || isPendingLocalHistoryMessage(previousMessage)) {
      continue;
    }
    const historyIndex = historyMessages.findIndex(
      (message) => transcriptMessageIdentity(message) === identity,
    );
    if (historyIndex >= 0) {
      sharedPreviousIndex = previousIndex;
      sharedHistoryIndex = historyIndex;
      break;
    }
  }
  if (sharedPreviousIndex < 0) {
    for (let previousIndex = previousMessages.length - 1; previousIndex >= 0; previousIndex--) {
      const previousMessage = previousMessages[previousIndex];
      if (isPendingLocalHistoryMessage(previousMessage)) {
        continue;
      }
      const signature = messageDisplaySignature(previousMessage);
      if (!signature) {
        continue;
      }
      for (let historyIndex = historyMessages.length - 1; historyIndex >= 0; historyIndex--) {
        if (isPendingLocalHistoryMessage(historyMessages[historyIndex])) {
          continue;
        }
        if (messageDisplaySignature(historyMessages[historyIndex]) !== signature) {
          continue;
        }
        sharedPreviousIndex = previousIndex;
        sharedHistoryIndex = historyIndex;
        break;
      }
      if (sharedPreviousIndex >= 0) {
        break;
      }
    }
  }
  if (sharedPreviousIndex < 0 || sharedHistoryIndex < 0) {
    return preserveMessagesAddedSinceRequestStart(
      historyMessages,
      requestStartMessages,
      previousMessages,
    );
  }

  const consumedHistoryIdentityIndexes = new Set<number>();
  const historySignatureCounts = new Map<string, number>();
  for (const message of historyMessages.slice(sharedHistoryIndex + 1)) {
    const signature = messageDisplaySignature(message);
    if (!signature) {
      continue;
    }
    const count = historySignatureCounts.get(signature);
    historySignatureCounts.set(signature, count ? count + 1 : 1);
  }

  const preservedTail: unknown[] = [];
  for (const message of previousMessages.slice(sharedPreviousIndex + 1)) {
    if (shouldHideHistoryMessage(message)) {
      return historyMessages;
    }
    const identity = transcriptMessageIdentity(message);
    const isPendingLocalMessage = isPendingLocalHistoryMessage(message);
    if (identity && !isPendingLocalMessage) {
      const historyIndex = historyMessages.findIndex(
        (historyMessage, index) =>
          index > sharedHistoryIndex &&
          !consumedHistoryIdentityIndexes.has(index) &&
          transcriptMessageIdentity(historyMessage) === identity,
      );
      if (historyIndex >= 0) {
        consumedHistoryIdentityIndexes.add(historyIndex);
        continue;
      }
      preservedTail.push(message);
      continue;
    }
    if (!isPendingLocalMessage) {
      return historyMessages;
    }
    const signature = messageDisplaySignature(message);
    if (!signature) {
      return historyMessages;
    }
    const count = historySignatureCounts.get(signature);
    if (count) {
      if (count === 1) {
        historySignatureCounts.delete(signature);
      } else {
        historySignatureCounts.set(signature, count - 1);
      }
      continue;
    }
    preservedTail.push(message);
  }
  return preservedTail.length > 0 ? [...historyMessages, ...preservedTail] : historyMessages;
}

function isRetryableStartupUnavailable(err: unknown, method: string): err is GatewayRequestError {
  if (!(err instanceof GatewayRequestError)) {
    return false;
  }
  if (err.gatewayCode !== "UNAVAILABLE" || !err.retryable) {
    return false;
  }
  const details = err.details;
  if (!details || typeof details !== "object") {
    return true;
  }
  const detailMethod = (details as { method?: unknown }).method;
  return typeof detailMethod !== "string" || detailMethod === method;
}

function resolveStartupRetryDelayMs(err: GatewayRequestError): number {
  const retryAfterMs =
    typeof err.retryAfterMs === "number" ? err.retryAfterMs : STARTUP_CHAT_HISTORY_DEFAULT_RETRY_MS;
  return Math.min(Math.max(retryAfterMs, 100), STARTUP_CHAT_HISTORY_MAX_RETRY_MS);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type ChatState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  sessionKey: string;
  chatLoading: boolean;
  chatMessages: unknown[];
  chatThinkingLevel: string | null;
  chatSending: boolean;
  chatMessage: string;
  chatAttachments: ChatAttachment[];
  chatRunId: string | null;
  chatStream: string | null;
  chatStreamStartedAt: number | null;
  lastError: string | null;
};

export type ChatHistoryLoadResult = "applied" | ChatHistoryStaleResult | "failed";

export type ChatEventPayload = {
  runId: string;
  sessionKey: string;
  state: "delta" | "final" | "aborted" | "error";
  message?: unknown;
  /** Incremental delta suffix (gateway `chat-incremental` capability). */
  appendText?: string;
  /** Replace the accumulated stream with `appendText` instead of appending. */
  reset?: boolean;
  errorMessage?: string;
};

function maybeResetToolStream(state: ChatState) {
  const toolHost = state as ChatState & Partial<Parameters<typeof resetToolStream>[0]>;
  if (
    toolHost.toolStreamById instanceof Map &&
    Array.isArray(toolHost.toolStreamOrder) &&
    Array.isArray(toolHost.chatToolMessages) &&
    Array.isArray(toolHost.chatStreamSegments)
  ) {
    resetToolStream(toolHost as Parameters<typeof resetToolStream>[0]);
  }
}

export async function loadChatHistory(state: ChatState): Promise<ChatHistoryLoadResult> {
  if (!state.client || !state.connected) {
    return "stale";
  }
  const requestStartMessages = [...state.chatMessages];
  const sessionKey = state.sessionKey;
  const requestVersion = beginChatHistoryRequest(state);
  const startedAt = Date.now();
  state.chatLoading = true;
  state.lastError = null;
  try {
    let res: { messages?: Array<unknown>; thinkingLevel?: string };
    for (;;) {
      try {
        res = await state.client.request<{ messages?: Array<unknown>; thinkingLevel?: string }>(
          "chat.history",
          {
            sessionKey,
            limit: 200,
          },
        );
        break;
      } catch (err) {
        if (!shouldApplyChatHistoryResult(state, requestVersion, sessionKey)) {
          return resolveChatHistoryStaleResult(state, requestVersion);
        }
        const withinStartupRetryWindow =
          Date.now() - startedAt < STARTUP_CHAT_HISTORY_RETRY_TIMEOUT_MS;
        if (withinStartupRetryWindow && isRetryableStartupUnavailable(err, "chat.history")) {
          await sleep(resolveStartupRetryDelayMs(err));
          if (!shouldApplyChatHistoryResult(state, requestVersion, sessionKey)) {
            return resolveChatHistoryStaleResult(state, requestVersion);
          }
          if (!state.client || !state.connected) {
            return "stale";
          }
          continue;
        }
        throw err;
      }
    }
    if (!shouldApplyChatHistoryResult(state, requestVersion, sessionKey)) {
      return resolveChatHistoryStaleResult(state, requestVersion);
    }
    const messages = Array.isArray(res.messages) ? res.messages : [];
    const visibleMessages = messages.filter((message) => !shouldHideHistoryMessage(message));
    state.chatMessages = preserveOptimisticTailMessages(
      visibleMessages,
      requestStartMessages,
      state.chatMessages,
    );
    state.chatThinkingLevel = res.thinkingLevel ?? null;
    // Clear all streaming state — history includes tool results and text
    // inline, so keeping streaming artifacts would cause duplicates.
    cancelPendingStream();
    maybeResetToolStream(state);
    state.chatStream = null;
    state.chatStreamStartedAt = null;
    return "applied";
  } catch (err) {
    if (!shouldApplyChatHistoryResult(state, requestVersion, sessionKey)) {
      return resolveChatHistoryStaleResult(state, requestVersion);
    }
    if (isMissingOperatorReadScopeError(err)) {
      state.chatMessages = [];
      state.chatThinkingLevel = null;
      state.lastError = formatMissingOperatorReadScopeMessage("existing chat history");
    } else {
      state.lastError = String(err);
    }
    return "failed";
  } finally {
    if (isLatestChatHistoryRequest(state, requestVersion)) {
      state.chatLoading = false;
    }
  }
}

function dataUrlToBase64(dataUrl: string): { content: string; mimeType: string } | null {
  const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  if (!match) {
    return null;
  }
  return { mimeType: match[1], content: match[2] };
}

function buildApiAttachments(attachments?: ChatAttachment[]) {
  const hasAttachments = attachments && attachments.length > 0;
  return hasAttachments
    ? attachments
        .map((att) => {
          const parsed = dataUrlToBase64(att.dataUrl);
          if (!parsed) {
            return null;
          }
          return {
            type: "image",
            mimeType: parsed.mimeType,
            content: parsed.content,
          };
        })
        .filter((a): a is NonNullable<typeof a> => a !== null)
    : undefined;
}

async function requestChatSend(
  state: ChatState,
  params: { message: string; attachments?: ChatAttachment[]; runId: string },
) {
  await state.client!.request("chat.send", {
    sessionKey: state.sessionKey,
    message: params.message,
    deliver: false,
    idempotencyKey: params.runId,
    attachments: buildApiAttachments(params.attachments),
  });
}

type AssistantMessageNormalizationOptions = {
  roleRequirement: "required" | "optional";
  roleCaseSensitive?: boolean;
  requireContentArray?: boolean;
  allowTextField?: boolean;
};

function normalizeAssistantMessage(
  message: unknown,
  options: AssistantMessageNormalizationOptions,
): Record<string, unknown> | null {
  if (!message || typeof message !== "object") {
    return null;
  }
  const candidate = message as Record<string, unknown>;
  const roleValue = candidate.role;
  if (typeof roleValue === "string") {
    const role = options.roleCaseSensitive ? roleValue : normalizeLowercaseStringOrEmpty(roleValue);
    if (role !== "assistant") {
      return null;
    }
  } else if (options.roleRequirement === "required") {
    return null;
  }

  if (options.requireContentArray) {
    return Array.isArray(candidate.content) ? candidate : null;
  }
  if (!("content" in candidate) && !(options.allowTextField && "text" in candidate)) {
    return null;
  }
  return candidate;
}

function normalizeAbortedAssistantMessage(message: unknown): Record<string, unknown> | null {
  return normalizeAssistantMessage(message, {
    roleRequirement: "required",
    roleCaseSensitive: true,
    requireContentArray: true,
  });
}

function normalizeFinalAssistantMessage(message: unknown): Record<string, unknown> | null {
  return normalizeAssistantMessage(message, {
    roleRequirement: "optional",
    allowTextField: true,
  });
}

export async function sendChatMessage(
  state: ChatState,
  message: string,
  attachments?: ChatAttachment[],
): Promise<string | null> {
  if (!state.client || !state.connected) {
    return null;
  }
  const msg = message.trim();
  const hasAttachments = attachments && attachments.length > 0;
  if (!msg && !hasAttachments) {
    return null;
  }

  const now = Date.now();

  cancelPendingStream();

  // Build user message content blocks
  const contentBlocks: Array<{ type: string; text?: string; source?: unknown }> = [];
  if (msg) {
    contentBlocks.push({ type: "text", text: msg });
  }
  // Add image previews to the message for display
  if (hasAttachments) {
    for (const att of attachments) {
      contentBlocks.push({
        type: "image",
        source: { type: "base64", media_type: att.mimeType, data: att.dataUrl },
      });
    }
  }

  state.chatMessages = [
    ...state.chatMessages,
    {
      role: "user",
      content: contentBlocks,
      timestamp: now,
    },
  ];

  state.chatSending = true;
  state.lastError = null;
  invalidateChatHistoryRequests(state, "run");
  const runId = generateUUID();
  state.chatRunId = runId;
  state.chatStream = "";
  state.chatStreamStartedAt = now;

  try {
    await requestChatSend(state, { message: msg, attachments, runId });
    return runId;
  } catch (err) {
    const error = formatConnectError(err);
    state.chatRunId = null;
    state.chatStream = null;
    state.chatStreamStartedAt = null;
    state.lastError = error;
    state.chatMessages = [
      ...state.chatMessages,
      {
        role: "assistant",
        content: [{ type: "text", text: "Error: " + error }],
        timestamp: Date.now(),
      },
    ];
    return null;
  } finally {
    state.chatSending = false;
  }
}

export async function sendDetachedChatMessage(
  state: ChatState,
  message: string,
  attachments?: ChatAttachment[],
): Promise<string | null> {
  if (!state.client || !state.connected) {
    return null;
  }
  const msg = message.trim();
  const hasAttachments = attachments && attachments.length > 0;
  if (!msg && !hasAttachments) {
    return null;
  }
  state.lastError = null;
  const runId = generateUUID();
  try {
    await requestChatSend(state, { message: msg, attachments, runId });
    return runId;
  } catch (err) {
    state.lastError = formatConnectError(err);
    return null;
  }
}

export async function sendSteerChatMessage(
  state: ChatState,
  message: string,
  attachments?: ChatAttachment[],
): Promise<string | null> {
  if (!state.client || !state.connected) {
    return null;
  }
  const msg = message.trim();
  const hasAttachments = attachments && attachments.length > 0;
  if (!msg && !hasAttachments) {
    return null;
  }
  invalidateChatHistoryRequests(state, "run");
  state.lastError = null;
  const runId = generateUUID();
  try {
    await requestChatSend(state, { message: msg, attachments, runId });
    return runId;
  } catch (err) {
    state.lastError = formatConnectError(err);
    return null;
  }
}

export async function abortChatRun(state: ChatState): Promise<boolean> {
  if (!state.client || !state.connected) {
    return false;
  }
  const runId = state.chatRunId;
  try {
    await state.client.request(
      "chat.abort",
      runId ? { sessionKey: state.sessionKey, runId } : { sessionKey: state.sessionKey },
    );
    return true;
  } catch (err) {
    state.lastError = formatConnectError(err);
    return false;
  }
}

export function handleChatEvent(state: ChatState, payload?: ChatEventPayload) {
  if (!payload) {
    return null;
  }
  if (payload.sessionKey !== state.sessionKey) {
    return null;
  }
  const payloadRunId = typeof payload.runId === "string" ? payload.runId.trim() : "";
  const activeRunId = typeof state.chatRunId === "string" ? state.chatRunId.trim() : "";
  if (hasHandledTerminalChatEvent(state, payload)) {
    return null;
  }
  markTerminalChatEventHandled(state, payload);

  // Final from another run (e.g. sub-agent announce): refresh history to show new message.
  // See https://github.com/PIXELZX0/Genesis/issues/1909
  if (
    state.chatRunId &&
    ((isTerminalChatEventState(payload.state) && payloadRunId !== activeRunId) ||
      (!isTerminalChatEventState(payload.state) &&
        payloadRunId !== "" &&
        payloadRunId !== activeRunId))
  ) {
    if (payload.state === "final") {
      const finalMessage = normalizeFinalAssistantMessage(payload.message);
      if (finalMessage && !isAssistantSilentReply(finalMessage)) {
        state.chatMessages = [...state.chatMessages, finalMessage];
        return null;
      }
      return "final";
    }
    return null;
  }

  if (payload.state === "delta") {
    if (typeof payload.appendText === "string") {
      // Incremental delta (gateway `chat-incremental` capability): accumulate the
      // appended suffix onto the running stream, or replace it on `reset`.
      const base = payload.reset ? "" : currentStreamText(state);
      const nextText = base + payload.appendText;
      if (!isSilentReplyStream(nextText)) {
        scheduleStreamUpdate(state, nextText);
      }
    } else {
      // Full-snapshot delta (legacy / non-capable path).
      const next = extractText(payload.message);
      if (typeof next === "string" && !isSilentReplyStream(next)) {
        scheduleStreamUpdate(state, next);
      }
    }
  } else if (payload.state === "final") {
    flushPendingStream();
    const finalMessage = normalizeFinalAssistantMessage(payload.message);
    if (finalMessage && !isAssistantSilentReply(finalMessage)) {
      state.chatMessages = [...state.chatMessages, finalMessage];
    } else if (state.chatStream?.trim() && !isSilentReplyStream(state.chatStream)) {
      state.chatMessages = [
        ...state.chatMessages,
        {
          role: "assistant",
          content: [{ type: "text", text: state.chatStream }],
          timestamp: Date.now(),
        },
      ];
    }
    state.chatStream = null;
    state.chatRunId = null;
    state.chatStreamStartedAt = null;
  } else if (payload.state === "aborted") {
    flushPendingStream();
    const normalizedMessage = normalizeAbortedAssistantMessage(payload.message);
    if (normalizedMessage && !isAssistantSilentReply(normalizedMessage)) {
      state.chatMessages = [...state.chatMessages, normalizedMessage];
    } else {
      const streamedText = state.chatStream ?? "";
      if (streamedText.trim() && !isSilentReplyStream(streamedText)) {
        state.chatMessages = [
          ...state.chatMessages,
          {
            role: "assistant",
            content: [{ type: "text", text: streamedText }],
            timestamp: Date.now(),
          },
        ];
      }
    }
    state.chatStream = null;
    state.chatRunId = null;
    state.chatStreamStartedAt = null;
  } else if (payload.state === "error") {
    flushPendingStream();
    state.chatStream = null;
    state.chatRunId = null;
    state.chatStreamStartedAt = null;
    state.lastError = payload.errorMessage ?? "chat error";
  }
  return payload.state;
}
