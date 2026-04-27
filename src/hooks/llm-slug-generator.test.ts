import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GenesisConfig } from "../config/types.genesis.js";

const runEmbeddedPiAgentMock = vi.fn();

vi.mock("../agents/agent-scope.js", () => ({
  resolveDefaultAgentId: vi.fn(() => "main"),
  resolveAgentWorkspaceDir: vi.fn(() => "/tmp/genesis-agent"),
  resolveAgentDir: vi.fn(() => "/tmp/genesis-agent/.genesis-agent"),
  resolveAgentEffectiveModelPrimary: vi.fn(() => null),
}));

vi.mock("../agents/pi-embedded.js", () => ({
  runEmbeddedPiAgent: (...args: unknown[]) => runEmbeddedPiAgentMock(...args),
}));

import { generateSlugViaLLM } from "./llm-slug-generator.js";

describe("generateSlugViaLLM", () => {
  beforeEach(() => {
    runEmbeddedPiAgentMock.mockReset();
    runEmbeddedPiAgentMock.mockResolvedValue({
      payloads: [{ text: "test-slug" }],
    });
  });

  it("keeps the helper default timeout when no agent timeout is configured", async () => {
    await generateSlugViaLLM({
      sessionContent: "hello",
      cfg: {} as GenesisConfig,
    });

    expect(runEmbeddedPiAgentMock).toHaveBeenCalledOnce();
    expect(runEmbeddedPiAgentMock.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        timeoutMs: 15_000,
        cleanupBundleMcpOnRunEnd: true,
      }),
    );
  });

  it("honors configured agent timeoutSeconds for slow local providers", async () => {
    await generateSlugViaLLM({
      sessionContent: "hello",
      cfg: {
        agents: {
          defaults: {
            timeoutSeconds: 500,
          },
        },
      } as GenesisConfig,
    });

    expect(runEmbeddedPiAgentMock).toHaveBeenCalledOnce();
    expect(runEmbeddedPiAgentMock.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        timeoutMs: 500_000,
      }),
    );
  });
});
