import { jsonResult, stringEnum } from "genesis/plugin-sdk/core";
import { Type } from "typebox";
import type { JevQuestion, JevResult } from "./jev-client.js";

type JevToolQuestion = {
  id: string;
  type: "boolean" | "choice" | "score";
  instructions: string;
  options?: Array<{ name: string; description?: string }>;
  levels?: string[];
};

export function toJevQuestions(raw: JevToolQuestion[]): Record<string, JevQuestion> {
  const questions: Record<string, JevQuestion> = {};
  for (const question of raw) {
    switch (question.type) {
      case "boolean":
        questions[question.id] = { type: "boolean", instructions: question.instructions };
        break;
      case "choice":
        if (!question.options?.length) {
          throw new Error(`Question "${question.id}" (choice) needs at least one option.`);
        }
        questions[question.id] = {
          type: "choice",
          instructions: question.instructions,
          criteria: Object.fromEntries(
            question.options.map((option) => [option.name, option.description ?? option.name]),
          ),
        };
        break;
      case "score":
        if (!question.levels || question.levels.length < 2) {
          throw new Error(`Question "${question.id}" (score) needs at least two levels.`);
        }
        questions[question.id] = {
          type: "score",
          instructions: question.instructions,
          criteria: question.levels,
        };
        break;
    }
  }
  return questions;
}

export function createJevEvaluateTool(
  evaluate: (
    state: string,
    questions: Record<string, JevQuestion>,
    signal?: AbortSignal,
  ) => Promise<JevResult>,
) {
  return {
    name: "jev_evaluate",
    label: "Jev Evaluate",
    description:
      "Fast typed judgment with TypeSafe Jev (via Vercel AI Gateway). Give a state and atomic questions; " +
      "returns calibrated probabilities. Use for classification, routing, yes/no checks and rubric scoring. " +
      "Jev cannot write text, count, or do math.",
    parameters: Type.Object(
      {
        state: Type.String({
          description: "The content to judge. Keep it focused on what matters.",
        }),
        questions: Type.Array(
          Type.Object(
            {
              id: Type.String({ description: "Answer key." }),
              type: stringEnum(["boolean", "choice", "score"]),
              instructions: Type.String({ description: "One atomic, literal question." }),
              options: Type.Optional(
                Type.Array(
                  Type.Object({
                    name: Type.String(),
                    description: Type.Optional(Type.String()),
                  }),
                  { description: "choice only: the allowed answers." },
                ),
              ),
              levels: Type.Optional(
                Type.Array(Type.String(), {
                  description: "score only: ordered levels, lowest first (min 2).",
                }),
              ),
            },
            { additionalProperties: false },
          ),
          { minItems: 1 },
        ),
      },
      { additionalProperties: false },
    ),
    execute: async (
      _toolCallId: string,
      params: { state: string; questions: JevToolQuestion[] },
      signal?: AbortSignal,
    ) => {
      const result = await evaluate(params.state, toJevQuestions(params.questions), signal);
      return jsonResult({ answers: result.answers, usage: result.usage });
    },
  };
}
