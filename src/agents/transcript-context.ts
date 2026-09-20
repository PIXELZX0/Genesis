import type { StreamFn } from "@earendil-works/pi-agent-core";
import {
  collapseSystemMessages,
  getCurrentSystemPrompt,
  getCurrentTools,
  getInitialSystemMessage,
  getSystemMessageText,
  withoutInitialSystemMessage,
  type Context,
  type Message,
  type SystemMessage,
  type TextContent,
  type Tool,
} from "@earendil-works/pi-ai";

/**
 * Transcript context as the pi stream entry points accept it. Since pi 0.86 the
 * system prompt and tool declarations live in the transcript's system messages
 * instead of `context.systemPrompt` / `context.tools`, so every Genesis site that
 * used to read or rewrite those fields goes through the helpers below.
 */
export type StreamContext = Parameters<StreamFn>[1];

function isSystemMessage(message: Message): message is SystemMessage {
  return message?.role === "system";
}

/** Transports and wrappers receive partially built contexts in tests and legacy call paths. */
function messagesOf(context: StreamContext): Message[] {
  return Array.isArray(context?.messages) ? context.messages : [];
}

/**
 * A context built before pi 0.86 (or by a caller that still uses `Context`) carries the
 * prompt and tools next to the messages instead of inside a system message.
 */
function legacyFieldsOf(context: StreamContext): { systemPrompt?: string; tools?: Tool[] } {
  const candidate = context as unknown as { systemPrompt?: unknown; tools?: unknown };
  return {
    ...(typeof candidate?.systemPrompt === "string"
      ? { systemPrompt: candidate.systemPrompt }
      : {}),
    ...(Array.isArray(candidate?.tools) ? { tools: candidate.tools as Tool[] } : {}),
  };
}

function mapMessageText(content: SystemMessage["content"], transform: (text: string) => string) {
  if (typeof content === "string") {
    return transform(content);
  }
  return content.map((entry): TextContent => ({ ...entry, text: transform(entry.text) }));
}

/** Current system prompt text of a transcript, with every later update replayed. */
export function readSystemPrompt(context: StreamContext): string {
  return (
    getCurrentSystemPrompt(messagesOf(context)) || (legacyFieldsOf(context).systemPrompt ?? "")
  );
}

/** Tools available after applying every transcript delta in order. */
export function readTools(context: StreamContext): Tool[] {
  const declared = getCurrentTools(messagesOf(context));
  return declared.length > 0 ? declared : (legacyFieldsOf(context).tools ?? []);
}

/**
 * Rewrite every system-prompt text the transcript carries, leaving message order,
 * section names, and tool declarations untouched so prompt-cache prefixes still match.
 */
export function mapSystemPrompt(
  context: StreamContext,
  transform: (text: string) => string,
): StreamContext {
  let changed = false;
  const messages: Message[] = [];
  for (const message of messagesOf(context)) {
    if (!isSystemMessage(message)) {
      messages.push(message);
      continue;
    }
    const next: SystemMessage = { ...message, content: mapMessageText(message.content, transform) };
    if (message.sections) {
      next.sections = Object.fromEntries(
        Object.entries(message.sections).map(([name, value]) => [
          name,
          typeof value === "string" ? transform(value) : value,
        ]),
      );
    }
    changed = true;
    messages.push(next);
  }
  const legacySystemPrompt = legacyFieldsOf(context).systemPrompt;
  if (legacySystemPrompt !== undefined) {
    return { ...context, messages, systemPrompt: transform(legacySystemPrompt) } as StreamContext;
  }
  return changed ? ({ ...context, messages } as StreamContext) : context;
}

/**
 * Narrow the tools the transcript declares to those matching `predicate`. Tool execution
 * still resolves against the agent's full tool set; this only changes what is advertised.
 */
export function filterDeclaredTools(
  context: StreamContext,
  predicate: (tool: Tool) => boolean,
): StreamContext {
  const messages: Message[] = [];
  for (const message of messagesOf(context)) {
    if (!isSystemMessage(message) || !message.toolsAdded) {
      messages.push(message);
      continue;
    }
    const next: SystemMessage = { ...message, toolsAdded: message.toolsAdded.filter(predicate) };
    messages.push(next);
  }
  return { ...context, messages } as StreamContext;
}

/**
 * Drop the prompt text from the transcript while keeping its tool declarations, for
 * transports that carry the prompt outside the message list (Google prompt caching).
 */
export function withoutSystemPrompt(context: StreamContext): StreamContext {
  const messages = messagesOf(context).flatMap((message): Message[] => {
    if (!isSystemMessage(message)) {
      return [message];
    }
    const carriesTools =
      (message.toolsAdded?.length ?? 0) > 0 || (message.toolsRemoved?.length ?? 0) > 0;
    if (!carriesTools) {
      return [];
    }
    const { sections: _sections, ...rest } = message;
    return [{ ...rest, content: "" }];
  });
  const { systemPrompt: _legacySystemPrompt, ...rest } = context as StreamContext & {
    systemPrompt?: string;
  };
  return { ...rest, messages } as StreamContext;
}

/**
 * Pre-0.86 view of a transcript: the replayed prompt and tool set next to a message list
 * without the leading system message. Transports that build provider payloads from
 * `systemPrompt` / `tools` convert once at their stream entry point and keep working on
 * the flat shape.
 */
export function toLegacyContext(context: StreamContext): Context & { tools: Tool[] } {
  const collapsed = collapseSystemMessages({ ...context, messages: messagesOf(context) });
  const leading = getInitialSystemMessage(collapsed.messages);
  const legacy = legacyFieldsOf(context);
  const systemPrompt =
    (leading ? getSystemMessageText(leading) : "") || (legacy.systemPrompt ?? "");
  const declaredTools = getCurrentTools(messagesOf(context));
  return {
    ...(systemPrompt ? { systemPrompt } : {}),
    tools: declaredTools.length > 0 ? declaredTools : (legacy.tools ?? []),
    messages: withoutInitialSystemMessage(collapsed.messages),
  };
}
