import { describe, expect, it } from "vitest";
import { buildConfigModelSuggestions } from "./config-model-suggestions.ts";
import type { ModelCatalogEntry } from "./types.ts";

const entry = (id: string, provider: string): ModelCatalogEntry => ({ id, name: id, provider });

describe("buildConfigModelSuggestions", () => {
  it("qualifies catalog ids and dedupes them", () => {
    const suggestions = buildConfigModelSuggestions([
      entry("claude-opus-4-8", "anthropic"),
      entry("anthropic/claude-opus-4-8", "anthropic"),
      entry("gpt-5.4", "openai"),
    ]);
    expect(suggestions["tools.advisor.model"]).toEqual([
      "anthropic/claude-opus-4-8",
      "openai/gpt-5.4",
    ]);
    expect(suggestions["tools.exec.safeguard.model"]).toEqual(suggestions["tools.advisor.model"]);
  });

  it("returns no suggestions for an empty catalog", () => {
    expect(buildConfigModelSuggestions([])).toEqual({});
  });
});
