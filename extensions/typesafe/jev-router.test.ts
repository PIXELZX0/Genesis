import { describe, expect, it, vi } from "vitest";
import type { JevQuestion, JevResult } from "./jev-client.js";
import {
  buildRouterState,
  classifyToolParams,
  decideModelCallRoute,
  isUseTool,
  latestBrowserTargets,
  type JevEvaluate,
} from "./jev-router.js";
import { toJevQuestions } from "./jev-tool.js";

const browserTool = {
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
};
const screenshotTool = {
  name: "computer-use__screenshot",
  description: "Capture the screen",
  parameters: {
    type: "object",
    properties: {
      display: { type: "string", enum: ["main", "secondary"] },
      save: { type: "boolean" },
    },
    required: ["display"],
  },
};
const clickTool = {
  name: "computer-use__left_click",
  description: "Click at screen coordinates",
  parameters: {
    type: "object",
    properties: { coordinate: { type: "array", items: { type: "number" } } },
    required: ["coordinate"],
  },
};
const statusTool = {
  name: "session_status",
  description: "Show session status",
  parameters: {
    type: "object",
    properties: { scope: { type: "string", enum: ["current", "all"] } },
    required: ["scope"],
  },
};
const tools = [browserTool, screenshotTool, clickTool, statusTool];

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
const browserLoop = [{ role: "user", content: "sign in" }, snapshotResult];
const screenLoop = [
  { role: "user", content: "check the screen" },
  { role: "toolResult", toolName: "computer-use__left_click", content: "clicked" },
];

function evaluator(answers: JevResult["answers"]) {
  const calls: Array<Record<string, JevQuestion>> = [];
  const evaluate: JevEvaluate = vi.fn(async (_state, questions) => {
    calls.push(questions);
    return { answers, usage: undefined };
  });
  return { evaluate, calls };
}

function next(choice: string, probability = 0.9): JevResult["answers"] {
  return { next_action: { type: "choice", choice, probabilities: { [choice]: probability } } };
}

function decide(answers: JevResult["answers"], messages: unknown[] = browserLoop) {
  const { evaluate, calls } = evaluator(answers);
  return {
    calls,
    evaluate,
    route: decideModelCallRoute({ messages, tools, config: { minConfidence: 0.6 }, evaluate }),
  };
}

describe("classifyToolParams", () => {
  it("treats any free-form field as open", () => {
    expect(classifyToolParams(browserTool.parameters)).toEqual({ kind: "open" });
  });

  it("collects required closed params only", () => {
    const shape = classifyToolParams(screenshotTool.parameters);
    expect(shape.kind === "closed" && shape.required.map((param) => param.name)).toEqual([
      "display",
    ]);
    expect(classifyToolParams(undefined)).toEqual({ kind: "closed", required: [] });
  });
});

describe("isUseTool", () => {
  it("matches the browser and computer-use style MCP servers only", () => {
    expect(isUseTool("browser")).toBe(true);
    expect(isUseTool("computer-use__screenshot")).toBe(true);
    expect(isUseTool("claude-in-chrome__navigate")).toBe(true);
    expect(isUseTool("session_status")).toBe(false);
    expect(isUseTool("github__screen_pr")).toBe(false);
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
  it("skips Jev outside a browser/computer-use loop", async () => {
    for (const messages of [
      [{ role: "user", content: "hi" }],
      [{ role: "toolResult", toolName: "session_status", content: "ok" }],
    ]) {
      const { route, evaluate } = decide(next("browser:snapshot"), messages);
      await expect(route).resolves.toEqual({ action: "pass" });
      expect(evaluate).not.toHaveBeenCalled();
    }
  });

  it("offers only model-free use actions in one round trip", async () => {
    const { route, calls } = decide(next("__other__"));
    await expect(route).resolves.toEqual({ action: "pass" });
    expect(calls).toHaveLength(1);
    expect(Object.keys((calls[0].next_action as { criteria: object }).criteria)).toEqual([
      "browser:snapshot",
      "browser:click",
      "computer-use__screenshot",
      "__other__",
    ]);
    expect(Object.keys(calls[0])).toEqual([
      "next_action",
      "browser:click_target",
      "arg:computer-use__screenshot:display",
    ]);
  });

  it("never alters the model call: uncertainty passes", async () => {
    await expect(decide(next("browser:snapshot", 0.4)).route).resolves.toEqual({
      action: "pass",
    });
    await expect(
      decide({
        ...next("browser:click"),
        "browser:click_target": { type: "choice", choice: "e2", probabilities: { e2: 0.4 } },
      }).route,
    ).resolves.toEqual({ action: "pass" });
  });

  it("clicks the Jev-picked snapshot element", async () => {
    const { route, calls } = decide({
      ...next("browser:click"),
      "browser:click_target": { type: "choice", choice: "e2", probabilities: { e2: 0.95 } },
    });
    await expect(route).resolves.toEqual({
      action: "tool_call",
      toolName: "browser",
      arguments: { action: "act", request: { kind: "click", ref: "e2" } },
    });
    expect(calls[0]["browser:click_target"]).toMatchObject({
      criteria: { e1: '[e1] heading "Example"', e2: '[e2] button "Sign in"', e3: "[e3] link" },
    });
  });

  it("calls closed-argument computer-use tools directly", async () => {
    const { route, calls } = decide(
      {
        ...next("computer-use__screenshot", 0.95),
        "arg:computer-use__screenshot:display": {
          type: "choice",
          choice: "main",
          probabilities: { main: 0.9, secondary: 0.1 },
        },
      },
      screenLoop,
    );
    await expect(route).resolves.toEqual({
      action: "tool_call",
      toolName: "computer-use__screenshot",
      arguments: { display: "main" },
    });
    // No browser snapshot yet, so no click option or target question.
    expect(Object.keys((calls[0].next_action as { criteria: object }).criteria)).toEqual([
      "browser:snapshot",
      "computer-use__screenshot",
      "__other__",
    ]);
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

describe("latestBrowserTargets", () => {
  it("indexes refs from the latest browser snapshot only", () => {
    expect(latestBrowserTargets(browserLoop)).toEqual({
      e1: 'heading "Example"',
      e2: 'button "Sign in"',
      e3: "link",
    });
    expect(
      latestBrowserTargets([
        ...browserLoop,
        { role: "toolResult", toolName: "browser", content: "clicked" },
      ]),
    ).toEqual({});
  });
});
