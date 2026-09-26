import { describe, expect, it } from "vitest";
import {
  createIdleTimeoutBreakerState,
  hasCompletedModelProgressForIdleBreaker,
  MAX_CONSECUTIVE_IDLE_TIMEOUTS_BEFORE_OUTPUT,
  stepIdleTimeoutBreaker,
} from "./idle-timeout-breaker.js";

const idle = { idleTimedOut: true, completedModelProgress: false };

describe("idle-timeout breaker", () => {
  it("trips after the cap of consecutive progress-free idle timeouts", () => {
    const state = createIdleTimeoutBreakerState();
    for (let i = 1; i < MAX_CONSECUTIVE_IDLE_TIMEOUTS_BEFORE_OUTPUT; i += 1) {
      expect(stepIdleTimeoutBreaker(state, idle).tripped).toBe(false);
    }
    expect(stepIdleTimeoutBreaker(state, idle)).toEqual({
      consecutive: MAX_CONSECUTIVE_IDLE_TIMEOUTS_BEFORE_OUTPUT,
      tripped: true,
    });
  });

  it("resets on progress and ignores non-timeout failures", () => {
    const state = createIdleTimeoutBreakerState();
    stepIdleTimeoutBreaker(state, idle);
    stepIdleTimeoutBreaker(state, { idleTimedOut: false, completedModelProgress: false });
    expect(state.consecutiveIdleTimeoutsBeforeOutput).toBe(1);
    stepIdleTimeoutBreaker(state, { idleTimedOut: true, completedModelProgress: true });
    expect(state.consecutiveIdleTimeoutsBeforeOutput).toBe(0);
  });

  it("counts only completed text or tool work as progress", () => {
    const base = {
      assistantTexts: ["  "],
      toolMetas: [],
      itemLifecycle: { startedCount: 1, completedCount: 0, activeCount: 1 },
    };
    expect(hasCompletedModelProgressForIdleBreaker(base)).toBe(false);
    expect(hasCompletedModelProgressForIdleBreaker({ ...base, assistantTexts: ["hi"] })).toBe(true);
    expect(
      hasCompletedModelProgressForIdleBreaker({ ...base, toolMetas: [{ toolName: "read" }] }),
    ).toBe(true);
  });
});
