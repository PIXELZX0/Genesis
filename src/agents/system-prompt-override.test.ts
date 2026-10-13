import { describe, expect, it } from "vitest";
import { AgentDefaultsSchema } from "../config/zod-schema.agent-defaults.js";
import {
  resolveSystemPromptOverride,
  resolveSystemPromptSectionOrder,
} from "./system-prompt-override.js";

describe("resolveSystemPromptOverride", () => {
  it("uses defaults when no per-agent override exists", () => {
    expect(
      resolveSystemPromptOverride({
        config: {
          agents: {
            defaults: { systemPromptOverride: "  default system  " },
            list: [{ id: "main" }],
          },
        },
        agentId: "main",
      }),
    ).toBe("default system");
  });

  it("prefers the per-agent override", () => {
    expect(
      resolveSystemPromptOverride({
        config: {
          agents: {
            defaults: { systemPromptOverride: "default system" },
            list: [{ id: "main", systemPromptOverride: "  agent system  " }],
          },
        },
        agentId: "main",
      }),
    ).toBe("agent system");
  });

  it("ignores blank override values", () => {
    expect(
      resolveSystemPromptOverride({
        config: {
          agents: {
            defaults: { systemPromptOverride: "default system" },
            list: [{ id: "main", systemPromptOverride: "   " }],
          },
        },
        agentId: "main",
      }),
    ).toBe("default system");
  });
});

describe("resolveSystemPromptSectionOrder", () => {
  it("prefers the per-agent order over defaults", () => {
    const config = {
      agents: {
        defaults: { systemPromptSectionOrder: ["safety" as const] },
        list: [
          { id: "main", systemPromptSectionOrder: ["project_context" as const, "*" as const] },
        ],
      },
    };
    expect(resolveSystemPromptSectionOrder({ config, agentId: "main" })).toEqual([
      "project_context",
      "*",
    ]);
    expect(resolveSystemPromptSectionOrder({ config, agentId: "other" })).toEqual(["safety"]);
  });

  it("lets a per-agent empty list restore the built-in order", () => {
    const config = {
      agents: {
        defaults: { systemPromptSectionOrder: ["safety" as const] },
        list: [{ id: "main", systemPromptSectionOrder: [] }],
      },
    };
    expect(resolveSystemPromptSectionOrder({ config, agentId: "MAIN" })).toEqual([]);
  });

  it("rejects unknown and duplicate section ids", () => {
    expect(
      AgentDefaultsSchema.safeParse({ systemPromptSectionOrder: ["safety", "*"] }).success,
    ).toBe(true);
    expect(AgentDefaultsSchema.safeParse({ systemPromptSectionOrder: ["nope"] }).success).toBe(
      false,
    );
    expect(
      AgentDefaultsSchema.safeParse({ systemPromptSectionOrder: ["safety", "safety"] }).success,
    ).toBe(false);
  });
});
