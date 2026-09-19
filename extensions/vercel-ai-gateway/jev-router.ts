import type {
  PluginHookBeforeModelCallResult,
  PluginHookModelCallTool,
} from "genesis/plugin-sdk/plugin-entry";
import { z } from "zod";
import { jevAnswerConfidence, type JevQuestion, type JevResult } from "./jev-client.js";

export const REPLY_OPTION = "__reply__";
const NEXT_QUESTION = "next_action";
// Jev accuracy drops with irrelevant context, and its window is ~32k tokens.
const STATE_BUDGET_CHARS = 16_000;
const ENTRY_TEXT_CHARS = 2_000;
const TOOL_DESCRIPTION_CHARS = 200;

export const jevRouterConfigSchema = z
  .object({
    enabled: z.boolean().default(false),
    minConfidence: z.number().min(0).max(1).default(0.6),
    maxConsecutiveDirectCalls: z.number().int().min(0).default(8),
    timeoutMs: z.number().int().positive().default(3_000),
  })
  .default({
    enabled: false,
    minConfidence: 0.6,
    maxConsecutiveDirectCalls: 8,
    timeoutMs: 3_000,
  });

export type JevRouterConfig = z.infer<typeof jevRouterConfigSchema>;

export type JevEvaluate = (
  state: unknown,
  questions: Record<string, JevQuestion>,
) => Promise<JevResult>;

type StateEntry =
  | { role: "user" | "assistant"; text: string }
  | { role: "tool_call"; tool: string; arguments: unknown }
  | { role: "tool_result"; tool: string; isError: boolean; text: string };

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function textOf(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .map((block: { type?: string; text?: string }) =>
      block?.type === "text" && typeof block.text === "string" ? block.text : "",
    )
    .filter(Boolean)
    .join("\n");
}

function toStateEntries(message: unknown): StateEntry[] {
  const msg = message as { role?: string; content?: unknown; toolName?: string; isError?: boolean };
  switch (msg?.role) {
    case "user":
      return [{ role: "user", text: truncate(textOf(msg.content), ENTRY_TEXT_CHARS) }];
    case "toolResult":
      return [
        {
          role: "tool_result",
          tool: msg.toolName ?? "unknown",
          isError: msg.isError === true,
          text: truncate(textOf(msg.content), ENTRY_TEXT_CHARS),
        },
      ];
    case "assistant": {
      const entries: StateEntry[] = [];
      const text = textOf(msg.content);
      if (text) {
        entries.push({ role: "assistant", text: truncate(text, ENTRY_TEXT_CHARS) });
      }
      for (const block of Array.isArray(msg.content) ? msg.content : []) {
        if (block?.type === "toolCall") {
          entries.push({ role: "tool_call", tool: block.name, arguments: block.arguments });
        }
      }
      return entries;
    }
    default:
      return [];
  }
}

/** Compact, budgeted view of the conversation: latest user request plus the newest turns. */
export function buildRouterState(messages: unknown[]): {
  user_request: string;
  recent: StateEntry[];
} {
  const entries = messages.flatMap(toStateEntries);
  const lastUser = entries.findLast((entry) => entry.role === "user");
  const recent: StateEntry[] = [];
  let used = 0;
  for (let i = entries.length - 1; i >= 0; i--) {
    const size = JSON.stringify(entries[i]).length;
    if (used + size > STATE_BUDGET_CHARS) {
      break;
    }
    used += size;
    recent.unshift(entries[i]);
  }
  return {
    user_request: lastUser && "text" in lastUser ? lastUser.text : "",
    recent,
  };
}

export function buildNextActionQuestion(tools: PluginHookModelCallTool[]): JevQuestion {
  const criteria: Record<string, string> = {};
  for (const tool of tools.toSorted((a, b) => a.name.localeCompare(b.name))) {
    criteria[tool.name] = truncate(tool.description || tool.name, TOOL_DESCRIPTION_CHARS);
  }
  criteria[REPLY_OPTION] =
    "Respond to the user in text: the task is done, the user must be asked something, or no tool is needed.";
  return {
    type: "choice",
    instructions:
      "Which single action should the assistant take next to make progress on the user's request?",
    criteria,
  };
}

type JsonSchemaProperty = {
  type?: unknown;
  enum?: unknown;
  const?: unknown;
  description?: unknown;
};

type ClosedParam =
  | { name: string; kind: "const"; value: unknown }
  | { name: string; kind: "enum"; values: string[]; description?: string }
  | { name: string; kind: "boolean"; description?: string };

function classifyProperty(name: string, prop: JsonSchemaProperty): ClosedParam | null {
  const description = typeof prop.description === "string" ? prop.description : undefined;
  if (prop.const !== undefined) {
    return { name, kind: "const", value: prop.const };
  }
  if (
    Array.isArray(prop.enum) &&
    prop.enum.length > 0 &&
    prop.enum.every((v) => typeof v === "string")
  ) {
    return { name, kind: "enum", values: prop.enum, description };
  }
  if (prop.type === "boolean") {
    return { name, kind: "boolean", description };
  }
  return null;
}

/**
 * `closed` when every parameter is a const/enum/boolean, so Jev can pick all values.
 * Any free-form field (string, number, object, ...) makes the tool `open` for the LLM.
 */
export function classifyToolParams(
  parameters: unknown,
): { kind: "closed"; required: ClosedParam[] } | { kind: "open" } {
  const schema = (parameters ?? {}) as {
    properties?: Record<string, JsonSchemaProperty>;
    required?: unknown;
  };
  const properties = schema.properties ?? {};
  const required = new Set(Array.isArray(schema.required) ? schema.required : []);
  const closedRequired: ClosedParam[] = [];
  for (const [name, prop] of Object.entries(properties)) {
    const closed = classifyProperty(name, prop ?? {});
    if (!closed) {
      return { kind: "open" };
    }
    // Optional params keep the tool's defaults instead of being guessed.
    if (required.has(name)) {
      closedRequired.push(closed);
    }
  }
  return { kind: "closed", required: closedRequired };
}

export function buildArgQuestions(
  tool: PluginHookModelCallTool,
  params: ClosedParam[],
): Record<string, JevQuestion> {
  const questions: Record<string, JevQuestion> = {};
  const toolLabel = `the next "${tool.name}" tool call (${truncate(tool.description, TOOL_DESCRIPTION_CHARS)})`;
  for (const param of params) {
    const hint = "description" in param && param.description ? ` ${param.description}` : "";
    if (param.kind === "enum") {
      questions[param.name] = {
        type: "choice",
        instructions: `Choose the "${param.name}" argument for ${toolLabel}.${hint}`,
        criteria: Object.fromEntries(param.values.map((value) => [value, value])),
      };
    } else if (param.kind === "boolean") {
      questions[param.name] = {
        type: "boolean",
        instructions: `Should the "${param.name}" argument be true for ${toolLabel}?${hint}`,
      };
    }
  }
  return questions;
}

function argValue(param: ClosedParam, answer: JevResult["answers"][string] | undefined): unknown {
  if (param.kind === "const") {
    return param.value;
  }
  if (!answer) {
    return undefined;
  }
  if (param.kind === "enum" && answer.type === "choice") {
    return answer.choice;
  }
  if (param.kind === "boolean" && answer.type === "boolean") {
    return answer.probability >= 0.5;
  }
  return undefined;
}

/** Picks the next step with Jev; any doubt defers to the LLM. */
export async function decideModelCallRoute(params: {
  messages: unknown[];
  tools: PluginHookModelCallTool[];
  config: Pick<JevRouterConfig, "minConfidence">;
  allowDirectCall: boolean;
  evaluate: JevEvaluate;
}): Promise<PluginHookBeforeModelCallResult> {
  const { tools, config, evaluate } = params;
  if (tools.length === 0) {
    return { action: "pass" };
  }
  const state = buildRouterState(params.messages);
  const next = (await evaluate(state, { [NEXT_QUESTION]: buildNextActionQuestion(tools) })).answers[
    NEXT_QUESTION
  ];
  if (next?.type !== "choice" || jevAnswerConfidence(next) < config.minConfidence) {
    return { action: "pass" };
  }
  if (next.choice === REPLY_OPTION) {
    return { action: "no_tools" };
  }
  const tool = tools.find((candidate) => candidate.name === next.choice);
  if (!tool) {
    return { action: "pass" };
  }
  const forced = { action: "force_tool", toolName: tool.name } as const;
  const shape = classifyToolParams(tool.parameters);
  if (shape.kind === "open" || !params.allowDirectCall) {
    return forced;
  }
  const questions = buildArgQuestions(tool, shape.required);
  const answers = Object.keys(questions).length
    ? (await evaluate({ ...state, next_tool: tool.name }, questions)).answers
    : {};
  const args: Record<string, unknown> = {};
  for (const param of shape.required) {
    const answer = answers[param.name];
    if (answer && jevAnswerConfidence(answer) < config.minConfidence) {
      return forced;
    }
    const value = argValue(param, answer);
    if (value === undefined) {
      return forced;
    }
    args[param.name] = value;
  }
  return { action: "tool_call", toolName: tool.name, arguments: args };
}
