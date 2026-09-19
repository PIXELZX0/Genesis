import { describe, expect, it, vi } from "vitest";
import type { JevQuestion, JevResult } from "./jev-client.js";
import {
  buildRouterState,
  classifyToolParams,
  decideModelCallRoute,
  REPLY_OPTION,
  type JevEvaluate,
} from "./jev-router.js";
import { toJevQuestions } from "./jev-tool.js";

const tools = [
  {
    name: "browser",
    description: "Control the browser",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["snapshot", "click"] },
        ref: { type: "string" },
      },
      required: ["action"],
    },
  },
  {
    name: "session_status",
    description: "Show session status",
    parameters: {
      type: "object",
      properties: {
        scope: { type: "string", enum: ["current", "all"] },
        verbose: { type: "boolean" },
        extra: { type: "boolean" },
      },
      required: ["scope", "verbose"],
    },
  },
];

const messages = [{ role: "user", content: "open example.com" }];

function evaluator(...results: Array<JevResult["answers"]>) {
  const calls: Array<Record<string, JevQuestion>> = [];
  const evaluate: JevEvaluate = vi.fn(async (_state, questions) => {
    calls.push(questions);
    return { answers: results[calls.length - 1] ?? {} };
  });
  return { evaluate, calls };
}

function next(choice: string, probability: number): JevResult["answers"] {
  return { next_action: { type: "choice", choice, probabilities: { [choice]: probability } } };
}

async function decide(evaluate: JevEvaluate, allowDirectCall = true) {
  return decideModelCallRoute({
    messages,
    tools,
    config: { minConfidence: 0.6 },
    allowDirectCall,
    evaluate,
  });
}

describe("classifyToolParams", () => {
  it("treats any free-form field as open", () => {
    expect(classifyToolParams(tools[0].parameters)).toEqual({ kind: "open" });
  });

  it("collects required closed params only", () => {
    const shape = classifyToolParams(tools[1].parameters);
    expect(shape.kind === "closed" && shape.required.map((param) => param.name)).toEqual([
      "scope",
      "verbose",
    ]);
    expect(classifyToolParams(undefined)).toEqual({ kind: "closed", required: [] });
  });
});

describe("buildRouterState", () => {
  it("keeps the latest user request and bounds the transcript", () => {
    const long = "x".repeat(5_000);
    const state = buildRouterState([
      { role: "user", content: "first" },
      ...Array.from({ length: 20 }, () => ({
        role: "toolResult",
        toolName: "read",
        content: [{ type: "text", text: long }],
      })),
      { role: "user", content: [{ type: "text", text: "latest" }] },
    ]);
    expect(state.user_request).toBe("latest");
    expect(JSON.stringify(state.recent).length).toBeLessThanOrEqual(16_000);
    expect(state.recent.at(-1)).toEqual({ role: "user", text: "latest" });
  });
});

describe("decideModelCallRoute", () => {
  it("passes when Jev is unsure", async () => {
    await expect(decide(evaluator(next("browser", 0.4)).evaluate)).resolves.toEqual({
      action: "pass",
    });
  });

  it("disables tools when Jev picks a text reply", async () => {
    const { evaluate, calls } = evaluator(next(REPLY_OPTION, 0.9));
    await expect(decide(evaluate)).resolves.toEqual({ action: "no_tools" });
    expect(Object.keys((calls[0].next_action as { criteria: object }).criteria)).toEqual([
      "browser",
      "session_status",
      REPLY_OPTION,
    ]);
  });

  it("forces the tool when the LLM must write free-form arguments", async () => {
    await expect(decide(evaluator(next("browser", 0.9)).evaluate)).resolves.toEqual({
      action: "force_tool",
      toolName: "browser",
    });
  });

  it("calls closed-set tools directly with Jev-picked arguments", async () => {
    const { evaluate, calls } = evaluator(next("session_status", 0.95), {
      scope: { type: "choice", choice: "all", probabilities: { all: 0.9, current: 0.1 } },
      verbose: { type: "boolean", probability: 0.1 },
    });
    await expect(decide(evaluate)).resolves.toEqual({
      action: "tool_call",
      toolName: "session_status",
      arguments: { scope: "all", verbose: false },
    });
    expect(Object.keys(calls[1])).toEqual(["scope", "verbose"]);
  });

  it("defers to the LLM when an argument is uncertain or direct calls are exhausted", async () => {
    const uncertain = evaluator(next("session_status", 0.95), {
      scope: { type: "choice", choice: "all", probabilities: { all: 0.5, current: 0.5 } },
      verbose: { type: "boolean", probability: 0.9 },
    });
    await expect(decide(uncertain.evaluate)).resolves.toMatchObject({ action: "force_tool" });
    await expect(
      decide(evaluator(next("session_status", 0.95)).evaluate, false),
    ).resolves.toMatchObject({ action: "force_tool" });
  });
});

describe("toJevQuestions", () => {
  it("maps tool question input to Jev criteria shapes", () => {
    expect(
      toJevQuestions([
        { id: "ok", type: "boolean", instructions: "Is it ok?" },
        {
          id: "route",
          type: "choice",
          instructions: "Route it",
          options: [{ name: "billing", description: "payments" }, { name: "other" }],
        },
        { id: "quality", type: "score", instructions: "Rate", levels: ["low", "high"] },
      ]),
    ).toEqual({
      ok: { type: "boolean", instructions: "Is it ok?" },
      route: {
        type: "choice",
        instructions: "Route it",
        criteria: { billing: "payments", other: "other" },
      },
      quality: { type: "score", instructions: "Rate", criteria: ["low", "high"] },
    });
    expect(() =>
      toJevQuestions([{ id: "s", type: "score", instructions: "Rate", levels: ["x"] }]),
    ).toThrow();
  });
});
