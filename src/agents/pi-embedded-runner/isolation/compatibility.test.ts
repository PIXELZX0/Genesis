import type { Api, Model } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { LegacyContextEngine } from "../../../context-engine/legacy.js";
import type { EmbeddedRunAttemptParams } from "../run/types.js";
import {
  clonePiIsolationAttempt,
  resolvePiIsolationBridgedHookNames,
  resolvePiIsolationStaticCompatibility,
  resolvePiIsolationToolCompatibility,
} from "./compatibility.js";

function createAttempt(
  overrides: Partial<EmbeddedRunAttemptParams> = {},
): EmbeddedRunAttemptParams {
  return {
    sessionId: "session-1",
    runId: "run-1",
    sessionFile: "/tmp/session.jsonl",
    workspaceDir: "/tmp/workspace",
    agentDir: "/tmp/agent",
    prompt: "hello",
    timeoutMs: 5_000,
    provider: "openai",
    modelId: "gpt-5.4",
    model: { provider: "openai", id: "gpt-5.4" } as Model<Api>,
    authStorage: {} as never,
    modelRegistry: {} as never,
    thinkLevel: "low",
    contextEngine: new LegacyContextEngine(),
    disableTools: true,
    ...overrides,
  };
}

describe("PI isolation compatibility", () => {
  it("accepts the standard legacy no-tool attempt", () => {
    expect(resolvePiIsolationStaticCompatibility(createAttempt(), null)).toEqual({
      compatible: true,
    });
  });

  it("falls back for a non-legacy context engine", () => {
    const result = resolvePiIsolationStaticCompatibility(
      createAttempt({
        contextEngine: {
          info: { id: "custom", name: "Custom" },
          ingest: async () => ({ ingested: false }),
          assemble: async ({ messages }) => ({ messages, estimatedTokens: 0 }),
          compact: async () => ({ ok: true, compacted: false }),
        },
      }),
      null,
    );
    expect(result).toMatchObject({ compatible: false, code: "context_engine" });
  });

  it("falls back before tool materialization when the session is sandboxed", () => {
    const result = resolvePiIsolationStaticCompatibility(
      createAttempt({
        disableTools: false,
        sessionKey: "agent:main:sandboxed",
        config: {
          agents: {
            defaults: {
              sandbox: { mode: "all" },
            },
          },
        },
      }),
      null,
    );
    expect(result).toMatchObject({ compatible: false, code: "sandbox_tool_contract" });
  });

  it("strips process-local fields before serialization", () => {
    const result = clonePiIsolationAttempt(
      createAttempt({
        onBlockReply: async () => undefined,
        abortSignal: new AbortController().signal,
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.attempt).not.toHaveProperty("onBlockReply");
      expect(result.attempt).not.toHaveProperty("abortSignal");
      expect(result.attempt).not.toHaveProperty("authStorage");
      expect(result.attempt.model).toMatchObject({ provider: "openai", id: "gpt-5.4" });
    }
  });

  it("rejects explicitly incompatible tool contracts", () => {
    expect(
      resolvePiIsolationToolCompatibility({
        descriptors: [],
        hasArgumentAdapter: true,
        sandboxEnabled: false,
      }),
    ).toMatchObject({ compatible: false, code: "tool_argument_adapter" });
    expect(
      resolvePiIsolationToolCompatibility({
        descriptors: [{ name: "sessions_yield", label: "Yield", description: "", parameters: {} }],
        hasArgumentAdapter: false,
        sandboxEnabled: false,
      }),
    ).toEqual({ compatible: true });
  });

  it("bridges the default skill-workshop hooks without making its tool set incompatible", () => {
    const hookRunner = {
      hasHooks: (hookName: string) =>
        hookName === "before_prompt_build" || hookName === "agent_end",
    } as never;

    expect(resolvePiIsolationBridgedHookNames(hookRunner)).toEqual([
      "before_prompt_build",
      "agent_end",
    ]);
    expect(resolvePiIsolationStaticCompatibility(createAttempt(), hookRunner)).toEqual({
      compatible: true,
    });
    expect(
      resolvePiIsolationToolCompatibility({
        descriptors: [
          { name: "sessions_yield", label: "Yield", description: "", parameters: {} },
          {
            name: "skill_workshop",
            label: "Skill Workshop",
            description: "",
            parameters: {},
            pluginMeta: { pluginId: "skill-workshop", optional: false },
          },
        ],
        hasArgumentAdapter: false,
        sandboxEnabled: false,
      }),
    ).toEqual({ compatible: true });
  });

  it.each([
    "before_agent_start",
    "before_tool_call",
    "llm_input",
    "llm_output",
    "before_compaction",
    "after_compaction",
    "after_tool_call",
    "before_message_write",
    "tool_result_persist",
  ])("keeps fallback for the unbridged %s hook", (activeHook) => {
    const hookRunner = {
      hasHooks: (hookName: string) => hookName === activeHook,
    } as never;
    expect(resolvePiIsolationStaticCompatibility(createAttempt(), hookRunner)).toMatchObject({
      compatible: false,
      code: "lifecycle_hook",
    });
  });

  it("strips the internal hook proxy before attempt serialization", () => {
    const result = clonePiIsolationAttempt(
      createAttempt({
        isolatedHookRunner: {
          hasHooks: () => false,
          runBeforePromptBuild: async () => undefined,
          runAgentEnd: async () => undefined,
        },
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.attempt).not.toHaveProperty("isolatedHookRunner");
    }
  });
});
