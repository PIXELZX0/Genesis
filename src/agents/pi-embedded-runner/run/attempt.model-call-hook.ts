import { randomUUID } from "node:crypto";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, ToolCall } from "@earendil-works/pi-ai";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai/compat";
import type {
  PluginHookAgentContext,
  PluginHookBeforeModelCallResult,
} from "../../../plugins/hook-types.js";
import type { HookRunner } from "../../../plugins/hooks.js";
import { buildAssistantMessageWithZeroUsage } from "../../stream-message-shared.js";
import { log } from "../logger.js";

type StreamModel = Parameters<StreamFn>[0];
type StreamContext = Parameters<StreamFn>[1];
type StreamOptions = NonNullable<Parameters<StreamFn>[2]>;

/**
 * Maps a forced tool choice onto the transport-specific `tool_choice` shape.
 * Returns undefined when the API has no known named-tool form.
 */
export function resolveForcedToolChoice(api: string, toolName: string): unknown {
  switch (api) {
    case "anthropic-messages":
      return { type: "tool", name: toolName };
    case "openai-completions":
      return { type: "function", function: { name: toolName } };
    case "openai-responses":
    case "azure-openai-responses":
      return { type: "function", name: toolName };
    default:
      return undefined;
  }
}

function toolChoiceNoneSupported(api: string): boolean {
  return resolveForcedToolChoice(api, "_") !== undefined;
}

/** Applies a routing decision to the model call inputs; `undefined` means "call unchanged". */
export function applyModelCallRoute(params: {
  model: StreamModel;
  context: StreamContext;
  options: StreamOptions | undefined;
  route: Exclude<PluginHookBeforeModelCallResult, { action: "pass" | "tool_call" }>;
}): { context: StreamContext; options: StreamOptions } | undefined {
  const { model, context, route } = params;
  const options: StreamOptions = { ...params.options };
  if (route.action === "no_tools") {
    if (!toolChoiceNoneSupported(model.api)) {
      return undefined;
    }
    (options as { toolChoice?: unknown }).toolChoice = "none";
    return { context, options };
  }
  const forced = resolveForcedToolChoice(model.api, route.toolName);
  if (forced === undefined) {
    // No named tool_choice on this transport: narrow the advertised tools instead.
    // Tool execution still resolves against the agent's full tool set.
    return {
      context: {
        ...context,
        tools: context.tools?.filter((tool) => tool.name === route.toolName),
      },
      options,
    };
  }
  (options as { toolChoice?: unknown }).toolChoice = forced;
  if (model.api === "anthropic-messages") {
    // Anthropic rejects forced tool_choice while extended thinking is on.
    options.reasoning = undefined;
  }
  return { context, options };
}

/** Builds a completed assistant stream that calls one tool without contacting the model. */
export function createSyntheticToolCallStream(params: {
  model: StreamModel;
  toolName: string;
  arguments: Record<string, unknown>;
}): ReturnType<typeof createAssistantMessageEventStream> {
  const toolCall: ToolCall = {
    type: "toolCall",
    id: `call_${randomUUID().replaceAll("-", "").slice(0, 24)}`,
    name: params.toolName,
    arguments: params.arguments,
  };
  const message: AssistantMessage = buildAssistantMessageWithZeroUsage({
    model: { api: params.model.api, provider: params.model.provider, id: params.model.id },
    content: [toolCall],
    stopReason: "toolUse",
  });
  const stream = createAssistantMessageEventStream();
  queueMicrotask(() => {
    stream.push({ type: "start", partial: { ...message, content: [] } });
    stream.push({ type: "toolcall_start", contentIndex: 0, partial: message });
    stream.push({ type: "toolcall_end", contentIndex: 0, toolCall, partial: message });
    stream.push({ type: "done", reason: "toolUse", message });
    stream.end();
  });
  return stream;
}

function isKnownTool(context: StreamContext, toolName: string): boolean {
  return context.tools?.some((tool) => tool.name === toolName) ?? false;
}

/**
 * Runs `before_model_call` plugin hooks before each model call in the agent loop.
 * Hook failures or unknown tool names fall back to the unchanged call.
 */
export function wrapStreamFnWithBeforeModelCallHook(
  inner: StreamFn,
  params: {
    hookRunner: Pick<HookRunner, "hasHooks" | "runBeforeModelCall"> | null | undefined;
    runId: string;
    sessionId: string;
    hookCtx: PluginHookAgentContext;
  },
): StreamFn {
  const { hookRunner } = params;
  if (!hookRunner?.hasHooks("before_model_call")) {
    return inner;
  }
  // Anthropic rejects re-enabling thinking mid tool loop once a turn lacks thinking blocks,
  // so after a routed call keep thinking off until the next user turn.
  let thinkingSuspended = false;
  const callInner: StreamFn = (model, context, options) =>
    thinkingSuspended && model.api === "anthropic-messages"
      ? inner(model, context, { ...options, reasoning: undefined })
      : inner(model, context, options);
  return async (model, context, options) => {
    if (context.messages.at(-1)?.role === "user") {
      thinkingSuspended = false;
    }
    let route: PluginHookBeforeModelCallResult | undefined;
    try {
      route = await hookRunner.runBeforeModelCall(
        {
          runId: params.runId,
          sessionId: params.sessionId,
          provider: model.provider,
          model: model.id,
          api: model.api,
          systemPrompt: context.systemPrompt,
          messages: context.messages,
          tools: (context.tools ?? []).map((tool) => ({
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
          })),
        },
        params.hookCtx,
      );
    } catch (err) {
      log.warn(`before_model_call hook failed: ${String(err)}`);
      return callInner(model, context, options);
    }
    if (!route || route.action === "pass") {
      return callInner(model, context, options);
    }
    if (route.action !== "no_tools" && !isKnownTool(context, route.toolName)) {
      log.warn(`before_model_call routed to unknown tool "${route.toolName}"; ignoring`);
      return callInner(model, context, options);
    }
    if (route.action !== "no_tools" && model.api === "anthropic-messages") {
      thinkingSuspended = true;
    }
    if (route.action === "tool_call") {
      return createSyntheticToolCallStream({
        model,
        toolName: route.toolName,
        arguments: route.arguments,
      });
    }
    const applied = applyModelCallRoute({ model, context, options, route });
    return applied
      ? callInner(model, applied.context, applied.options)
      : callInner(model, context, options);
  };
}
