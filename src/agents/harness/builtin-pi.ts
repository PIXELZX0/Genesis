import { createSubsystemLogger } from "../../logging/subsystem.js";
import { getGlobalHookRunner } from "../../plugins/hook-runner-global.js";
import {
  clonePiIsolationAttempt,
  resolvePiIsolationStaticCompatibility,
  resolvePiIsolationToolCompatibility,
  type PiIsolationCompatibility,
} from "../pi-embedded-runner/isolation/compatibility.js";
import {
  PiIsolatedProcessError,
  runIsolatedPiAttempt,
} from "../pi-embedded-runner/isolation/parent.js";
import {
  createPiIsolationToolHost,
  PiIsolationToolContractError,
} from "../pi-embedded-runner/isolation/tool-host.js";
import { runEmbeddedAttempt } from "../pi-embedded-runner/run/attempt.js";
import type {
  EmbeddedRunAttemptParams,
  EmbeddedRunAttemptResult,
} from "../pi-embedded-runner/run/types.js";
import type { AgentHarness } from "./types.js";

const log = createSubsystemLogger("agents/pi-isolation");

async function runInProcessWithReason(
  params: EmbeddedRunAttemptParams,
  compatibility: PiIsolationCompatibility & { compatible: false },
): Promise<EmbeddedRunAttemptResult> {
  log.warn("PI isolation compatibility fallback; using in-process backend", {
    code: compatibility.code,
    reason: compatibility.reason,
    provider: params.provider,
    modelId: params.modelId,
    runId: params.runId,
  });
  const result = await runEmbeddedAttempt(params);
  return {
    ...result,
    piIsolation: {
      mode: "in-process",
      fallbackCode: compatibility.code,
      fallbackReason: compatibility.reason,
    },
  };
}

function isPiIsolationDisabledByEnv(): boolean {
  return process.env.GENESIS_PI_ISOLATION === "0";
}

async function runPiAttempt(params: EmbeddedRunAttemptParams): Promise<EmbeddedRunAttemptResult> {
  if (isPiIsolationDisabledByEnv()) {
    return await runInProcessWithReason(params, {
      compatible: false,
      code: "disabled",
      reason: "PI isolation disabled via GENESIS_PI_ISOLATION=0",
    });
  }
  const hookRunner = getGlobalHookRunner();
  const staticCompatibility = resolvePiIsolationStaticCompatibility(params, hookRunner);
  if (!staticCompatibility.compatible) {
    return await runInProcessWithReason(params, staticCompatibility);
  }
  const cloned = clonePiIsolationAttempt(params);
  if (!cloned.ok) {
    return await runInProcessWithReason(params, cloned.compatibility);
  }

  let toolHost: Awaited<ReturnType<typeof createPiIsolationToolHost>>;
  try {
    toolHost = await createPiIsolationToolHost(params);
  } catch (error) {
    if (error instanceof PiIsolationToolContractError) {
      return await runInProcessWithReason(params, {
        compatible: false,
        code: "tool_schema",
        reason: error.message,
      });
    }
    throw error;
  }
  const toolCompatibility = resolvePiIsolationToolCompatibility({
    descriptors: toolHost.descriptors,
    hasArgumentAdapter: toolHost.hasArgumentAdapter,
    sandboxEnabled: toolHost.sandboxEnabled,
  });
  if (!toolCompatibility.compatible) {
    toolHost.abortController.abort(new Error("PI isolation compatibility fallback"));
    return await runInProcessWithReason(params, toolCompatibility);
  }
  try {
    return await runIsolatedPiAttempt({
      attempt: params,
      wireAttempt: cloned.attempt,
      toolHost,
      hookRunner,
    });
  } catch (error) {
    if (error instanceof PiIsolatedProcessError && error.replaySafe) {
      toolHost.abortController.abort(new Error("PI isolation child unavailable"));
      return await runInProcessWithReason(params, {
        compatible: false,
        code: "child_unavailable",
        reason: error.message,
      });
    }
    throw error;
  }
}

export function createPiAgentHarness(): AgentHarness {
  return {
    id: "pi",
    label: "PI embedded agent",
    supports: () => ({ supported: true, priority: 0 }),
    runAttempt: runPiAttempt,
  };
}
