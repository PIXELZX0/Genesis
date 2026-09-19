import { describe, expect, it, vi } from "vitest";
import type { JevQuestion, JevResult } from "./jev-client.js";
import {
  buildRouterState,
  classifyToolParams,
  decideModelCallRoute,
  latestBrowserTargets,
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

function evaluator(answers: JevResult["answers"]) {
  const calls: Array<Record<string, JevQuestion>> = [];
  const evaluate: JevEvaluate = vi.fn(async (_state, questions) => {
    calls.push(questions);
    return { answers, usage: undefined };
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
    const { evaluate, calls } = evaluator({
      ...next("session_status", 0.95),
      "arg:session_status:scope": {
        type: "choice",
        choice: "all",
        probabilities: { all: 0.9, current: 0.1 },
      },
      "arg:session_status:verbose": { type: "boolean", probability: 0.1 },
    });
    await expect(decide(evaluate)).resolves.toEqual({
      action: "tool_call",
      toolName: "session_status",
      arguments: { scope: "all", verbose: false },
    });
    // One round trip: tool choice plus speculative browser/closed-set arg questions.
    expect(calls).toHaveLength(1);
    expect(Object.keys(calls[0])).toEqual([
      "next_action",
      "browser:operation",
      "arg:session_status:scope",
      "arg:session_status:verbose",
    ]);
  });

  it("defers to the LLM when an argument is uncertain or direct calls are exhausted", async () => {
    const uncertain = evaluator({
      ...next("session_status", 0.95),
      "arg:session_status:scope": {
        type: "choice",
        choice: "all",
        probabilities: { all: 0.5, current: 0.5 },
      },
      "arg:session_status:verbose": { type: "boolean", probability: 0.9 },
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

describe("browser element selection", () => {
  const snapshotResult = {
    role: "toolResult",
    toolName: "browser",
    content: [
      {
        type: "text",
        text: '<<<EXTERNAL>>>\n- heading "Example" [ref=e1]\n  - button "Sign in" [ref=e2]\n  - link [ref=e3] [nth=1]\n<<<END>>>',
      },
    ],
  };
  const browserMessages = [{ role: "user", content: "sign in" }, snapshotResult];

  function decideBrowser(answers: JevResult["answers"], messages: unknown[] = browserMessages) {
    const { evaluate, calls } = evaluator(answers);
    return {
      calls,
      route: decideModelCallRoute({
        messages,
        tools,
        config: { minConfidence: 0.6 },
        allowDirectCall: true,
        evaluate,
      }),
    };
  }

  function op(choice: string, probability = 0.9): JevResult["answers"] {
    return {
      "browser:operation": { type: "choice", choice, probabilities: { [choice]: probability } },
    };
  }

  it("indexes refs from the latest browser snapshot only", () => {
    expect(latestBrowserTargets(browserMessages)).toEqual({
      e1: 'heading "Example"',
      e2: 'button "Sign in"',
      e3: "link",
    });
    expect(
      latestBrowserTargets([
        ...browserMessages,
        { role: "toolResult", toolName: "browser", content: "clicked" },
      ]),
    ).toEqual({});
  });

  it("clicks the Jev-picked element in one round trip", async () => {
    const { route, calls } = decideBrowser({
      ...next("browser", 0.9),
      ...op("click"),
      "browser:click_target": { type: "choice", choice: "e2", probabilities: { e2: 0.95 } },
    });
    await expect(route).resolves.toEqual({
      action: "tool_call",
      toolName: "browser",
      arguments: { action: "act", request: { kind: "click", ref: "e2" } },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]["browser:click_target"]).toMatchObject({
      criteria: { e1: '[e1] heading "Example"', e2: '[e2] button "Sign in"', e3: "[e3] link" },
    });
  });

  it("takes a snapshot directly and offers no click without one", async () => {
    const { route, calls } = decideBrowser({ ...next("browser", 0.9), ...op("snapshot") }, [
      { role: "user", content: "open the page" },
    ]);
    await expect(route).resolves.toEqual({
      action: "tool_call",
      toolName: "browser",
      arguments: { action: "snapshot" },
    });
    expect(Object.keys((calls[0]["browser:operation"] as { criteria: object }).criteria)).toEqual([
      "snapshot",
      "other",
    ]);
    expect(calls[0]["browser:click_target"]).toBeUndefined();
  });

  it("hands typing and uncertain targets to the LLM", async () => {
    await expect(decideBrowser({ ...next("browser", 0.9), ...op("other") }).route).resolves.toEqual(
      { action: "force_tool", toolName: "browser" },
    );
    await expect(
      decideBrowser({
        ...next("browser", 0.9),
        ...op("click"),
        "browser:click_target": { type: "choice", choice: "e2", probabilities: { e2: 0.4 } },
      }).route,
    ).resolves.toEqual({ action: "force_tool", toolName: "browser" });
  });
});
