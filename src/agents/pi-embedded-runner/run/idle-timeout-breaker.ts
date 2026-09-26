import type { EmbeddedRunAttemptResult } from "./types.js";

/**
 * Cap on consecutive attempts that idle-timed-out without completed model
 * progress. Spans profile/auth rotations inside one run so a wedged provider
 * cannot fan out paid calls across every profile (upstream openclaw#76293:
 * one heartbeat produced 700+ paid calls in 60s).
 */
export const MAX_CONSECUTIVE_IDLE_TIMEOUTS_BEFORE_OUTPUT = 5;

export type IdleTimeoutBreakerState = {
  consecutiveIdleTimeoutsBeforeOutput: number;
};

export function createIdleTimeoutBreakerState(): IdleTimeoutBreakerState {
  return { consecutiveIdleTimeoutsBeforeOutput: 0 };
}

type IdleTimeoutBreakerAttempt = Pick<
  EmbeddedRunAttemptResult,
  "assistantTexts" | "toolMetas" | "clientToolCall" | "itemLifecycle"
>;

/**
 * Completed text/tool progress only. Billed output tokens from a partial
 * stream are cost, not progress, so they must not disarm the breaker.
 */
export function hasCompletedModelProgressForIdleBreaker(
  attempt: IdleTimeoutBreakerAttempt,
): boolean {
  return (
    attempt.assistantTexts.some((text) => text.trim().length > 0) ||
    attempt.toolMetas.length > 0 ||
    Boolean(attempt.clientToolCall) ||
    attempt.itemLifecycle.completedCount > 0
  );
}

/**
 * Idle timeout without progress increments; any completed progress resets.
 * Non-timeout failures without progress leave the count unchanged.
 */
export function stepIdleTimeoutBreaker(
  state: IdleTimeoutBreakerState,
  input: { idleTimedOut: boolean; completedModelProgress: boolean },
  cap = MAX_CONSECUTIVE_IDLE_TIMEOUTS_BEFORE_OUTPUT,
): { consecutive: number; tripped: boolean } {
  if (input.completedModelProgress) {
    state.consecutiveIdleTimeoutsBeforeOutput = 0;
  } else if (input.idleTimedOut) {
    state.consecutiveIdleTimeoutsBeforeOutput += 1;
  }
  return {
    consecutive: state.consecutiveIdleTimeoutsBeforeOutput,
    tripped: cap > 0 && state.consecutiveIdleTimeoutsBeforeOutput >= cap,
  };
}
