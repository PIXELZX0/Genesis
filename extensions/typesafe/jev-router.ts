import type {
  PluginHookBeforeModelCallResult,
  PluginHookModelCallTool,
} from "genesis/plugin-sdk/plugin-entry";
import { z } from "zod";
import { jevAnswerConfidence, type JevQuestion, type JevResult } from "./jev-client.js";

const NEXT_QUESTION = "next_action";
const OTHER_OPTION = "__other__";
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

const BROWSER_TOOL = "browser";
const BROWSER_SNAPSHOT_OPTION = "browser:snapshot";
const BROWSER_CLICK_OPTION = "browser:click";
const BROWSER_TARGET_QUESTION = "browser:click_target";
// Bounds criteria size; elements past the cap cannot be picked (jev-ultrafast keeps 250).
const MAX_BROWSER_TARGETS = 150;
const SNAPSHOT_REF_LINE = /^\s*-\s*([\w-]+)(?:\s+"([^"\n]*)")?[^\n]*?\[ref=(e\d+)\]/gm;
// MCP tools are named `<server>__<tool>`; computer-use style servers pick their own names.
// ponytail: server-name heuristic; add a config allowlist if a use server is missed.
const USE_SERVER_NAME = /computer|desktop|screen|browser|chrome|playwright|puppeteer/i;

/** Browser or computer-use style tool: observe/act loops where Jev can skip the LLM. */
export function isUseTool(name: string): boolean {
  if (name === BROWSER_TOOL) {
    return true;
  }
  const separator = name.indexOf("__");
  return separator > 0 && USE_SERVER_NAME.test(name.slice(0, separator));
}

/** Indexed elements (`ref` → label) from the latest browser tool result, if it was a snapshot. */
export function latestBrowserTargets(messages: unknown[]): Record<string, string> {
  const last = messages.findLast(
    (message): message is { role: string; toolName?: string; content?: unknown } =>
      (message as { role?: string })?.role === "toolResult" &&
      (message as { toolName?: string }).toolName === BROWSER_TOOL,
  );
  const targets: Record<string, string> = {};
  if (!last) {
    return targets;
  }
  for (const [, role, name, ref] of textOf(last.content).matchAll(SNAPSHOT_REF_LINE)) {
    if (Object.keys(targets).length >= MAX_BROWSER_TARGETS) {
      break;
    }
    targets[ref] = truncate(name ? `${role} "${name}"` : role, TOOL_DESCRIPTION_CHARS);
  }
  return targets;
}

function argQuestionId(toolName: string, paramName: string): string {
  return `arg:${toolName}:${paramName}`;
}

type DirectTool = { tool: PluginHookModelCallTool; params: ClosedParam[] };

function isConfident(answer: JevResult["answers"][string] | undefined, min: number): boolean {
  return answer !== undefined && jevAnswerConfidence(answer) >= min;
}

/**
 * Inside a browser/computer-use loop, asks Jev in one request whether the next step is a
 * model-free action (snapshot, click on a snapshot element, closed-argument use tool).
 * Only ever returns `tool_call` or `pass`: the LLM request itself is never altered, so
 * tool_choice/thinking/tool lists stay stable and provider prompt caches keep hitting.
 */
export async function decideModelCallRoute(params: {
  messages: unknown[];
  tools: PluginHookModelCallTool[];
  config: Pick<JevRouterConfig, "minConfidence">;
  evaluate: JevEvaluate;
}): Promise<PluginHookBeforeModelCallResult> {
  const { tools, config } = params;
  const last = params.messages.at(-1) as { role?: string; toolName?: string } | undefined;
  // Only continue an active use loop; other turns skip Jev entirely (no added latency).
  if (last?.role !== "toolResult" || !last.toolName || !isUseTool(last.toolName)) {
    return { action: "pass" };
  }
  const options: Record<string, string> = {};
  const questions: Record<string, JevQuestion> = {};
  const hasBrowser = tools.some((tool) => tool.name === BROWSER_TOOL);
  const targets = hasBrowser ? latestBrowserTargets(params.messages) : {};
  if (hasBrowser) {
    options[BROWSER_SNAPSHOT_OPTION] =
      "Take a fresh browser page snapshot: there is no current snapshot or the page has changed.";
    if (Object.keys(targets).length > 0) {
      options[BROWSER_CLICK_OPTION] = "Click one element listed in the latest browser snapshot.";
      // Speculative: only read when the next action is a click.
      questions[BROWSER_TARGET_QUESTION] = {
        type: "choice",
        instructions:
          "Assuming the next step clicks an element on the current page, which element should be clicked?",
        criteria: Object.fromEntries(
          Object.entries(targets).map(([ref, label]) => [ref, `[${ref}] ${label}`]),
        ),
      };
    }
  }
  const direct = new Map<string, DirectTool>();
  for (const tool of tools.toSorted((a, b) => a.name.localeCompare(b.name))) {
    if (tool.name === BROWSER_TOOL || !isUseTool(tool.name)) {
      continue;
    }
    const shape = classifyToolParams(tool.parameters);
    if (shape.kind !== "closed") {
      continue;
    }
    direct.set(tool.name, { tool, params: shape.required });
    options[tool.name] = truncate(tool.description || tool.name, TOOL_DESCRIPTION_CHARS);
    for (const [paramName, question] of Object.entries(buildArgQuestions(tool, shape.required))) {
      questions[argQuestionId(tool.name, paramName)] = question;
    }
  }
  if (Object.keys(options).length === 0) {
    return { action: "pass" };
  }
  options[OTHER_OPTION] =
    "Anything else: typing text, navigating, clicking by screen coordinates, using another tool, or replying to the user.";
  const { answers } = await params.evaluate(buildRouterState(params.messages), {
    [NEXT_QUESTION]: {
      type: "choice",
      instructions:
        "Which single action should the assistant take next to make progress on the user's request?",
      criteria: options,
    },
    ...questions,
  });
  const next = answers[NEXT_QUESTION];
  if (next?.type !== "choice" || !isConfident(next, config.minConfidence)) {
    return { action: "pass" };
  }
  if (next.choice === BROWSER_SNAPSHOT_OPTION && hasBrowser) {
    return { action: "tool_call", toolName: BROWSER_TOOL, arguments: { action: "snapshot" } };
  }
  if (next.choice === BROWSER_CLICK_OPTION) {
    const target = answers[BROWSER_TARGET_QUESTION];
    return target?.type === "choice" &&
      Object.hasOwn(targets, target.choice) &&
      isConfident(target, config.minConfidence)
      ? {
          action: "tool_call",
          toolName: BROWSER_TOOL,
          arguments: { action: "act", request: { kind: "click", ref: target.choice } },
        }
      : { action: "pass" };
  }
  const picked = direct.get(next.choice);
  if (!picked) {
    return { action: "pass" };
  }
  const args: Record<string, unknown> = {};
  for (const param of picked.params) {
    const answer = answers[argQuestionId(picked.tool.name, param.name)];
    if (answer && !isConfident(answer, config.minConfidence)) {
      return { action: "pass" };
    }
    const value = argValue(param, answer);
    if (value === undefined) {
      return { action: "pass" };
    }
    args[param.name] = value;
  }
  return { action: "tool_call", toolName: picked.tool.name, arguments: args };
}
