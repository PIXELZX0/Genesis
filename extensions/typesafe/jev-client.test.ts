import { describe, expect, it } from "vitest";
import { buildJevRequest, parseJevResponse } from "./jev-client.js";

const questions = {
  urgent: { type: "boolean", instructions: "Is it urgent?" },
  team: { type: "choice", instructions: "Which team?", criteria: { billing: "payments" } },
} as const;

describe("buildJevRequest", () => {
  it("uses the AI SDK evaluation protocol for Vercel AI Gateway", () => {
    const request = buildJevRequest({
      backend: "vercel-ai-gateway",
      apiKey: "k",
      state: "s",
      questions,
    });
    expect(request.url).toBe("https://ai-gateway.vercel.sh/v4/ai/evaluation-model");
    expect(request.headers).toMatchObject({
      Authorization: "Bearer k",
      "ai-model-id": "typesafe-ai/jev",
      "ai-evaluation-model-specification-version": "4",
    });
    expect(request.body).toEqual({ state: "s", questions });
  });

  it("maps boolean questions to noul for TypeSafe and OpenRouter", () => {
    for (const [backend, url, model] of [
      ["typesafe", "https://api.typesafe.ai/v1/systemone", "jev-latest"],
      ["openrouter", "https://openrouter.ai/api/alpha/decisions", "typesafe/jev-latest"],
    ] as const) {
      const request = buildJevRequest({ backend, apiKey: "k", state: "s", questions });
      expect(request.url).toBe(url);
      expect(request.body).toEqual({
        model,
        state: "s",
        questions: {
          urgent: { type: "noul", instructions: "Is it urgent?" },
          team: questions.team,
        },
      });
    }
  });
});

describe("parseJevResponse", () => {
  it("normalizes noul answers and snake_case usage", () => {
    expect(
      parseJevResponse({
        model: "jev-latest",
        answers: {
          urgent: { type: "noul", noul: 0.92 },
          team: { type: "choice", choice: "billing", probabilities: { billing: 1 }, confidence: 1 },
        },
        usage: { input_tokens: 312, output_tokens: 48 },
        id: "gen-1",
      }),
    ).toEqual({
      answers: {
        urgent: { type: "boolean", probability: 0.92 },
        team: { type: "choice", choice: "billing", probabilities: { billing: 1 } },
      },
      usage: { inputTokens: 312, outputTokens: 48 },
    });
  });

  it("keeps Vercel boolean answers and camelCase usage", () => {
    expect(
      parseJevResponse({
        answers: { urgent: { type: "boolean", probability: 0.1 } },
        usage: { inputTokens: 5, outputTokens: 0 },
      }),
    ).toEqual({
      answers: { urgent: { type: "boolean", probability: 0.1 } },
      usage: { inputTokens: 5, outputTokens: 0 },
    });
  });
});
