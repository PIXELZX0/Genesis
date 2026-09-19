import { fetchWithSsrFGuard } from "genesis/plugin-sdk/ssrf-runtime";
import { z } from "zod";

export type JevBackend = "typesafe" | "openrouter" | "vercel-ai-gateway";

/** Backends tried in this order when `backend` is `auto`. */
export const JEV_BACKEND_ORDER: readonly JevBackend[] = [
  "typesafe",
  "vercel-ai-gateway",
  "openrouter",
];

export type JevQuestion =
  | { type: "boolean"; instructions: string; criteria?: { true: string; false: string } }
  | { type: "choice"; instructions: string; criteria: Record<string, string> }
  | { type: "score"; instructions: string; criteria: string[] };

const probabilitiesSchema = z.record(z.string(), z.number()).optional();

// Vercel AI Gateway calls yes/no answers `boolean`; TypeSafe and OpenRouter call them `noul`.
const answerSchema = z
  .discriminatedUnion("type", [
    z.object({ type: z.literal("choice"), choice: z.string(), probabilities: probabilitiesSchema }),
    z.object({ type: z.literal("score"), score: z.number(), probabilities: probabilitiesSchema }),
    z.object({ type: z.literal("boolean"), probability: z.number() }),
    z.object({ type: z.literal("noul"), noul: z.number() }),
  ])
  .transform((answer) =>
    answer.type === "noul" ? { type: "boolean" as const, probability: answer.noul } : answer,
  );

const responseSchema = z
  .object({
    answers: z.record(z.string(), answerSchema),
    usage: z
      .object({
        inputTokens: z.number().optional(),
        outputTokens: z.number().optional(),
        input_tokens: z.number().optional(),
        output_tokens: z.number().optional(),
      })
      .optional(),
  })
  .transform(({ answers, usage }) => ({
    answers,
    usage: usage && {
      inputTokens: usage.inputTokens ?? usage.input_tokens,
      outputTokens: usage.outputTokens ?? usage.output_tokens,
    },
  }));

export type JevResult = z.output<typeof responseSchema>;
export type JevAnswer = JevResult["answers"][string];

type BackendRequest = { url: string; headers: Record<string, string>; body: unknown };

/** Builds the wire request for one backend; only Vercel keeps the AI SDK `boolean` question type. */
export function buildJevRequest(params: {
  backend: JevBackend;
  apiKey: string;
  state: unknown;
  questions: Record<string, JevQuestion>;
}): BackendRequest {
  const auth = { Authorization: `Bearer ${params.apiKey}`, "Content-Type": "application/json" };
  if (params.backend === "vercel-ai-gateway") {
    // Evaluation models are only served on the AI SDK gateway protocol
    // (mirrors @ai-sdk/gateway GatewayEvaluationModel).
    return {
      url: "https://ai-gateway.vercel.sh/v4/ai/evaluation-model",
      headers: {
        ...auth,
        "ai-gateway-protocol-version": "0.0.1",
        "ai-gateway-auth-method": "api-key",
        "ai-evaluation-model-specification-version": "4",
        "ai-model-id": "typesafe-ai/jev",
      },
      body: { state: params.state, questions: params.questions },
    };
  }
  const questions = Object.fromEntries(
    Object.entries(params.questions).map(([id, question]) => [
      id,
      question.type === "boolean" ? { ...question, type: "noul" } : question,
    ]),
  );
  return params.backend === "openrouter"
    ? {
        url: "https://openrouter.ai/api/alpha/decisions",
        headers: auth,
        body: { model: "typesafe/jev-latest", state: params.state, questions },
      }
    : {
        url: "https://api.typesafe.ai/v1/systemone",
        headers: auth,
        body: { model: "jev-latest", state: params.state, questions },
      };
}

export function parseJevResponse(body: unknown): JevResult {
  return responseSchema.parse(body);
}

const RETRYABLE_STATUS = new Set([429, 503, 529]);
const MAX_ATTEMPTS = 3;

export async function evaluateWithJev(params: {
  backend: JevBackend;
  apiKey: string;
  state: unknown;
  questions: Record<string, JevQuestion>;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<JevResult> {
  const request = buildJevRequest(params);
  for (let attempt = 1; ; attempt++) {
    const { response, release } = await fetchWithSsrFGuard({
      url: request.url,
      timeoutMs: params.timeoutMs ?? 10_000,
      signal: params.signal,
      auditContext: `typesafe.jev.${params.backend}`,
      init: { method: "POST", headers: request.headers, body: JSON.stringify(request.body) },
    });
    try {
      if (response.ok) {
        return parseJevResponse(await response.json());
      }
      // Rate limit / overload: TypeSafe recommends exponential backoff.
      if (!RETRYABLE_STATUS.has(response.status) || attempt >= MAX_ATTEMPTS) {
        const detail = (await response.text()).slice(0, 500);
        throw new Error(
          `Jev evaluation via ${params.backend} failed: HTTP ${response.status} ${detail}`,
        );
      }
    } finally {
      await release();
    }
    await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** (attempt - 1)));
    params.signal?.throwIfAborted();
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
