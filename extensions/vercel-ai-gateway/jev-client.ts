import { fetchWithSsrFGuard } from "genesis/plugin-sdk/ssrf-runtime";
import { z } from "zod";
import { VERCEL_AI_GATEWAY_BASE_URL } from "./models.js";

export const JEV_MODEL_ID = "typesafe-ai/jev";

// Evaluation models are only served on the AI SDK gateway protocol, not the
// OpenAI/Anthropic-compatible endpoints (mirrors @ai-sdk/gateway GatewayEvaluationModel).
const EVALUATION_URL = `${VERCEL_AI_GATEWAY_BASE_URL}/v4/ai/evaluation-model`;

export type JevQuestion =
  | { type: "boolean"; instructions: string; criteria?: { true: string; false: string } }
  | { type: "choice"; instructions: string; criteria: Record<string, string> }
  | { type: "score"; instructions: string; criteria: string[] };

const answerSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("choice"),
    choice: z.string(),
    probabilities: z.record(z.string(), z.number()).optional(),
  }),
  z.object({
    type: z.literal("score"),
    score: z.number(),
    probabilities: z.record(z.string(), z.number()).optional(),
  }),
  z.object({ type: z.literal("boolean"), probability: z.number() }),
]);

const responseSchema = z.object({
  answers: z.record(z.string(), answerSchema),
  usage: z
    .object({ inputTokens: z.number().optional(), outputTokens: z.number().optional() })
    .optional(),
});

export type JevAnswer = z.infer<typeof answerSchema>;
export type JevResult = z.infer<typeof responseSchema>;

export async function evaluateWithJev(params: {
  apiKey: string;
  state: unknown;
  questions: Record<string, JevQuestion>;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<JevResult> {
  const { response, release } = await fetchWithSsrFGuard({
    url: EVALUATION_URL,
    timeoutMs: params.timeoutMs ?? 10_000,
    signal: params.signal,
    auditContext: "vercel-ai-gateway.jev",
    init: {
      method: "POST",
      headers: {
        Authorization: `Bearer ${params.apiKey}`,
        "Content-Type": "application/json",
        "ai-gateway-protocol-version": "0.0.1",
        "ai-gateway-auth-method": "api-key",
        "ai-evaluation-model-specification-version": "4",
        "ai-model-id": JEV_MODEL_ID,
      },
      body: JSON.stringify({ state: params.state, questions: params.questions }),
    },
  });
  try {
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 500);
      throw new Error(`Jev evaluation failed: HTTP ${response.status} ${detail}`);
    }
    return responseSchema.parse(await response.json());
  } finally {
    await release();
  }
}

/** Probability of the selected option (choice) or of the more likely side (boolean). */
export function jevAnswerConfidence(answer: JevAnswer): number {
  if (answer.type === "boolean") {
    return Math.max(answer.probability, 1 - answer.probability);
  }
  if (answer.type === "choice") {
    return answer.probabilities?.[answer.choice] ?? 0;
  }
  return answer.probabilities ? Math.max(...Object.values(answer.probabilities)) : 0;
}
