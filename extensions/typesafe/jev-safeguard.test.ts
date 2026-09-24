import { describe, expect, it, vi } from "vitest";
import type { JevResult } from "./jev-client.js";
import { assessExecToolCall } from "./jev-safeguard.js";

function riskResult(choice: string, probability: number): JevResult {
  return {
    answers: { risk: { type: "choice", choice, probabilities: { [choice]: probability } } },
    usage: undefined,
  };
}

function assess(result: JevResult, toolName = "exec", command = "rm -rf ./build") {
  const evaluate = vi.fn(async () => result);
  return {
    evaluate,
    verdict: assessExecToolCall({
      toolName,
      toolParams: { command },
      config: { blockConfidence: 0.8 },
      evaluate,
    }),
  };
}

describe("assessExecToolCall", () => {
  it("blocks confident high-risk commands", async () => {
    await expect(assess(riskResult("high", 0.95)).verdict).resolves.toMatchObject({
      block: true,
    });
  });

  it("asks for approval on unsure high and on medium risk", async () => {
    await expect(assess(riskResult("high", 0.6)).verdict).resolves.toMatchObject({
      requireApproval: { severity: "critical", pluginId: "typesafe" },
    });
    await expect(assess(riskResult("medium", 0.9)).verdict).resolves.toMatchObject({
      requireApproval: { severity: "warning" },
    });
  });

  it("leaves low-risk commands alone", async () => {
    await expect(assess(riskResult("low", 0.99)).verdict).resolves.toBeUndefined();
  });

  it("skips non-exec tools and empty commands without calling Jev", async () => {
    for (const run of [
      assess(riskResult("high", 1), "read"),
      assess(riskResult("high", 1), "exec", " "),
    ]) {
      await expect(run.verdict).resolves.toBeUndefined();
      expect(run.evaluate).not.toHaveBeenCalled();
    }
  });
});
