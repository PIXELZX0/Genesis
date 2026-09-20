import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
import { clearMemoryPluginState, registerMemoryPromptSection } from "../../plugins/memory-state.js";
import {
  applySystemPromptOverrideToSession,
  buildEmbeddedSystemPrompt,
  createSystemPromptOverride,
} from "./system-prompt.js";

type MutableSession = {
  _baseSystemPrompt?: string;
  _rebuildSystemPrompt?: (toolNames: string[]) => string;
};

type MockMessage = { role: string; content?: unknown; timestamp?: number };

type MockSession = MutableSession & {
  agent: {
    state: {
      messages: MockMessage[];
    };
  };
};

function createMockSession(messages: MockMessage[] = []): {
  session: MockSession;
} {
  const session = {
    agent: { state: { messages } },
  } as MockSession;
  return { session };
}

/** The prompt lives in the transcript's leading system message since pi 0.86. */
function readMockSystemPrompt(session: MockSession): unknown {
  return session.agent.state.messages.find((message) => message.role === "system")?.content;
}

function applyAndGetMutableSession(
  prompt: Parameters<typeof applySystemPromptOverrideToSession>[1],
  messages?: MockMessage[],
) {
  const { session } = createMockSession(messages);
  applySystemPromptOverrideToSession(session as unknown as AgentSession, prompt);
  return {
    mutable: session,
  };
}

describe("applySystemPromptOverrideToSession", () => {
  it("applies a string override to the session system prompt", () => {
    const prompt = "You are a helpful assistant with custom context.";
    const { mutable } = applyAndGetMutableSession(prompt);

    expect(readMockSystemPrompt(mutable)).toBe(prompt);
    expect(mutable._baseSystemPrompt).toBe(prompt);
  });

  it("trims whitespace from string overrides", () => {
    const { mutable } = applyAndGetMutableSession("  padded prompt  ");

    expect(readMockSystemPrompt(mutable)).toBe("padded prompt");
  });

  it("applies a function override to the session system prompt", () => {
    const override = createSystemPromptOverride("function-based prompt");
    const { mutable } = applyAndGetMutableSession(override);

    expect(readMockSystemPrompt(mutable)).toBe("function-based prompt");
  });

  it("replaces an existing leading system message and clears later prompt text", () => {
    const { mutable } = applyAndGetMutableSession("replacement prompt", [
      { role: "system", content: "original prompt", timestamp: 0 },
      { role: "user", content: "hi", timestamp: 1 },
      { role: "system", content: "later instructions", timestamp: 2 },
    ]);

    expect(mutable.agent.state.messages).toMatchObject([
      { role: "system", content: "replacement prompt" },
      { role: "user", content: "hi" },
      { role: "system", content: "" },
    ]);
  });

  it("sets _rebuildSystemPrompt that returns the override", () => {
    const { mutable } = applyAndGetMutableSession("rebuild test");
    expect(mutable._rebuildSystemPrompt?.(["tool1"])).toBe("rebuild test");
  });
});

describe("buildEmbeddedSystemPrompt", () => {
  afterEach(() => {
    clearMemoryPluginState();
  });

  it("forwards provider prompt contributions into the embedded prompt", () => {
    const prompt = buildEmbeddedSystemPrompt({
      workspaceDir: "/tmp/genesis",
      reasoningTagHint: false,
      runtimeInfo: {
        host: "local",
        os: "darwin",
        arch: "arm64",
        node: process.version,
        model: "gpt-5.4",
        provider: "openai",
      },
      tools: [],
      modelAliasLines: [],
      userTimezone: "UTC",
      promptContribution: {
        stablePrefix: "## Embedded Stable\n\nStable provider guidance.",
      },
    });

    expect(prompt).toContain("## Embedded Stable\n\nStable provider guidance.");
  });

  it("can omit base memory guidance for non-legacy context engines", () => {
    registerMemoryPromptSection(() => ["## Memory Recall", "Use memory carefully.", ""]);

    const prompt = buildEmbeddedSystemPrompt({
      workspaceDir: "/tmp/genesis",
      reasoningTagHint: false,
      runtimeInfo: {
        host: "local",
        os: "darwin",
        arch: "arm64",
        node: process.version,
        model: "gpt-5.4",
        provider: "openai",
      },
      tools: [],
      modelAliasLines: [],
      userTimezone: "UTC",
      includeMemorySection: false,
    });

    expect(prompt).not.toContain("## Memory Recall");
  });
});
