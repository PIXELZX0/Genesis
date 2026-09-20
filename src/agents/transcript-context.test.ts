import { normalizeContext } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import {
  filterDeclaredTools,
  mapSystemPrompt,
  readSystemPrompt,
  readTools,
  toLegacyContext,
  withoutSystemPrompt,
} from "./transcript-context.js";

const tools = [
  { name: "read", description: "Read a file", parameters: { type: "object" } },
  { name: "browser", description: "Drive the browser", parameters: { type: "object" } },
];

function makeContext() {
  return normalizeContext({
    systemPrompt: "Follow policy.",
    messages: [{ role: "user", content: "hi", timestamp: 1 }],
    tools,
  } as unknown as Parameters<typeof normalizeContext>[0]);
}

describe("transcript context helpers", () => {
  it("reads the prompt and tools out of the transcript's system messages", () => {
    const context = makeContext();

    expect(readSystemPrompt(context)).toContain("Follow policy.");
    expect(readTools(context).map((tool) => tool.name)).toEqual(["read", "browser"]);
  });

  it("rewrites system prompt text without touching other messages", () => {
    const mapped = mapSystemPrompt(makeContext(), (text) => text.replace("policy", "the policy"));

    expect(readSystemPrompt(mapped)).toContain("Follow the policy.");
    expect(mapped.messages.at(-1)).toMatchObject({ role: "user", content: "hi" });
    expect(readTools(mapped).map((tool) => tool.name)).toEqual(["read", "browser"]);
  });

  it("narrows declared tools while keeping the prompt", () => {
    const narrowed = filterDeclaredTools(makeContext(), (tool) => tool.name === "read");

    expect(readTools(narrowed).map((tool) => tool.name)).toEqual(["read"]);
    expect(readSystemPrompt(narrowed)).toContain("Follow policy.");
  });

  it("drops the prompt but keeps tool declarations", () => {
    const stripped = withoutSystemPrompt(makeContext());

    expect(readSystemPrompt(stripped)).toBe("");
    expect(readTools(stripped).map((tool) => tool.name)).toEqual(["read", "browser"]);
  });

  it("exposes the pre-0.86 flat shape for payload builders", () => {
    const legacy = toLegacyContext(makeContext());

    expect(legacy.systemPrompt).toContain("Follow policy.");
    expect(legacy.tools.map((tool) => tool.name)).toEqual(["read", "browser"]);
    expect(legacy.messages).toMatchObject([{ role: "user", content: "hi" }]);
  });

  it("falls back to flat fields when a caller still passes a pre-0.86 context", () => {
    const legacyInput = {
      systemPrompt: "Follow policy.",
      messages: [{ role: "user", content: "hi", timestamp: 1 }],
      tools,
    } as unknown as Parameters<typeof toLegacyContext>[0];

    expect(readSystemPrompt(legacyInput)).toBe("Follow policy.");
    expect(readTools(legacyInput).map((tool) => tool.name)).toEqual(["read", "browser"]);
    expect(toLegacyContext(legacyInput).systemPrompt).toBe("Follow policy.");
    expect(withoutSystemPrompt(legacyInput)).not.toHaveProperty("systemPrompt");
  });

  it("tolerates a context without messages", () => {
    const empty = {} as unknown as Parameters<typeof toLegacyContext>[0];

    expect(readSystemPrompt(empty)).toBe("");
    expect(readTools(empty)).toEqual([]);
    expect(toLegacyContext(empty).messages).toEqual([]);
  });
});
