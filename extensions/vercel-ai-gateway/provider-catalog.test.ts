import { describe, expect, it } from "vitest";
import { getStaticVercelAiGatewayModelCatalog, VERCEL_AI_GATEWAY_BASE_URL } from "./api.js";
import { parseVercelAiGatewayModels } from "./models.js";
import {
  buildStaticVercelAiGatewayProvider,
  buildVercelAiGatewayProvider,
} from "./provider-catalog.js";

describe("vercel ai gateway provider catalog", () => {
  it("builds the bundled Vercel AI Gateway defaults", async () => {
    const provider = await buildVercelAiGatewayProvider();

    expect(provider.baseUrl).toBe(VERCEL_AI_GATEWAY_BASE_URL);
    expect(provider.api).toBe("anthropic-messages");
    expect(provider.models?.map((model) => model.id)).toEqual(
      expect.arrayContaining([
        "anthropic/claude-opus-4.6",
        "openai/gpt-5.4",
        "openai/gpt-5.4-pro",
        "moonshotai/kimi-k2.6",
      ]),
    );
  });

  it("exposes the static fallback model catalog", () => {
    expect(getStaticVercelAiGatewayModelCatalog().map((model) => model.id)).toEqual(
      expect.arrayContaining([
        "anthropic/claude-opus-4.6",
        "openai/gpt-5.4",
        "openai/gpt-5.4-pro",
        "moonshotai/kimi-k2.6",
      ]),
    );
  });

  it("builds an offline static provider catalog", () => {
    expect(buildStaticVercelAiGatewayProvider().models?.map((model) => model.id)).toEqual(
      expect.arrayContaining(["moonshotai/kimi-k2.6"]),
    );
  });

  it("keeps only language models from live discovery", () => {
    const models = parseVercelAiGatewayModels({
      data: [
        { id: "anthropic/claude-opus-4.6", type: "language" },
        { id: "typesafe-ai/jev", type: "evaluation" },
        { id: "openai/text-embedding-3-small", type: "embedding" },
        { id: "legacy/untyped-model" },
      ],
    });
    expect(models.map((model) => model.id)).toEqual([
      "anthropic/claude-opus-4.6",
      "legacy/untyped-model",
    ]);
  });
});
