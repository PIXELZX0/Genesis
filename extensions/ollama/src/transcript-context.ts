import type { StreamFn } from "@earendil-works/pi-agent-core";
import {
  collapseSystemMessages,
  getCurrentTools,
  getInitialSystemMessage,
  getSystemMessageText,
  withoutInitialSystemMessage,
  type Context,
  type Tool,
} from "@earendil-works/pi-ai/compat";

/**
 * Pre-0.86 view of a transcript: pi now carries the system prompt and tool declarations
 * in the transcript's system messages, while the payload builders here still take the
 * flat `systemPrompt` / `tools` shape.
 */
export function toLegacyContext(context: Parameters<StreamFn>[1]): Context & { tools: Tool[] } {
  const messages = Array.isArray(context?.messages) ? context.messages : [];
  const collapsed = collapseSystemMessages({ ...context, messages });
  const leading = getInitialSystemMessage(collapsed.messages);
  // A context built before pi 0.86 still carries the prompt and tools as flat fields.
  const legacy = context as unknown as { systemPrompt?: unknown; tools?: unknown };
  const systemPrompt =
    (leading ? getSystemMessageText(leading) : "") ||
    (typeof legacy?.systemPrompt === "string" ? legacy.systemPrompt : "");
  const declaredTools = getCurrentTools(messages);
  const legacyTools = Array.isArray(legacy?.tools) ? (legacy.tools as Tool[]) : [];
  return {
    ...(systemPrompt ? { systemPrompt } : {}),
    tools: declaredTools.length > 0 ? declaredTools : legacyTools,
    messages: withoutInitialSystemMessage(collapsed.messages),
  };
}
