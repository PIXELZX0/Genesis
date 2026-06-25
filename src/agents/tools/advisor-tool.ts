import { Type } from "typebox";
import { callGateway } from "../../gateway/call.js";
import type { GatewayMessageChannel } from "../../utils/message-channel.js";
import type { SpawnedToolContext } from "../spawned-context.js";
import {
  captureSubagentCompletionReply,
  waitForSubagentRunOutcome,
} from "../subagent-announce-output.js";
import { spawnSubagentDirect } from "../subagent-spawn.js";
import { describeAdvisorTool } from "../tool-description-presets.js";
import type { AnyAgentTool } from "./common.js";
import { jsonResult, readStringParam } from "./common.js";

const DEFAULT_ADVISOR_TIMEOUT_SECONDS = 180;

export type AdvisorToolOptions = {
  /** Stronger model to consult, as "provider/model". */
  model: string;
  /** Max seconds to wait for the advisor's answer (default 180). */
  timeoutSeconds?: number;
  agentSessionKey?: string;
  agentChannel?: GatewayMessageChannel;
  agentAccountId?: string;
  agentTo?: string;
  agentThreadId?: string | number;
  /** Explicit agent ID override for cron/hook sessions. */
  requesterAgentIdOverride?: string;
} & SpawnedToolContext;

const AdvisorToolSchema = Type.Object({
  question: Type.String({
    description: "The specific problem or question to escalate to the stronger model.",
  }),
  context: Type.Optional(
    Type.String({
      description:
        "Relevant context the advisor needs: what you already tried, error messages, constraints, and the goal.",
    }),
  ),
});

function buildAdvisorTask(question: string, context: string | undefined): string {
  const lines = [
    "You are a senior advisor model. Another AI agent is stuck on a problem and is consulting you.",
    "Give concrete, actionable guidance it can apply directly. Be specific; do not ask follow-up questions.",
    "",
    `Question:\n${question}`,
  ];
  if (context && context.trim()) {
    lines.push("", `Context:\n${context.trim()}`);
  }
  return lines.join("\n");
}

async function deleteAdvisorSession(sessionKey: string | undefined): Promise<void> {
  const key = sessionKey?.trim();
  if (!key) {
    return;
  }
  try {
    await callGateway({
      method: "sessions.delete",
      params: { key, deleteTranscript: true, emitLifecycleHooks: false },
      timeoutMs: 10_000,
    });
  } catch {
    // Best-effort cleanup only.
  }
}

export function createAdvisorTool(opts: AdvisorToolOptions): AnyAgentTool {
  const timeoutMs =
    Math.max(1, Math.floor(opts.timeoutSeconds ?? DEFAULT_ADVISOR_TIMEOUT_SECONDS)) * 1000;

  return {
    name: "ask_advisor",
    label: "Advisor",
    description: describeAdvisorTool(opts.model),
    parameters: AdvisorToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const question = readStringParam(params, "question", { required: true });
      const context = readStringParam(params, "context");

      const spawn = await spawnSubagentDirect(
        {
          task: buildAdvisorTask(question, context),
          label: "advisor",
          model: opts.model,
          runTimeoutSeconds: Math.floor(timeoutMs / 1000),
          // Consultation: keep it self-contained and do not auto-deliver a
          // completion message to the parent channel — we return inline.
          cleanup: "keep",
          context: "isolated",
          expectsCompletionMessage: false,
        },
        {
          agentSessionKey: opts.agentSessionKey,
          agentChannel: opts.agentChannel,
          agentAccountId: opts.agentAccountId,
          agentTo: opts.agentTo,
          agentThreadId: opts.agentThreadId,
          agentGroupId: opts.agentGroupId,
          agentGroupChannel: opts.agentGroupChannel,
          agentGroupSpace: opts.agentGroupSpace,
          agentMemberRoleIds: opts.agentMemberRoleIds,
          requesterAgentIdOverride: opts.requesterAgentIdOverride,
          workspaceDir: opts.workspaceDir,
        },
      );

      if (spawn.status !== "accepted" || !spawn.runId) {
        await deleteAdvisorSession(spawn.childSessionKey);
        return jsonResult({
          status: "error",
          error:
            spawn.error ??
            `Advisor could not be reached (status: ${spawn.status}). Check that tools.advisor.model "${opts.model}" is configured and authenticated.`,
        });
      }

      try {
        const wait = await waitForSubagentRunOutcome(spawn.runId, timeoutMs);
        if (wait.status === "timeout") {
          return jsonResult({
            status: "timeout",
            error: `Advisor did not respond within ${Math.floor(timeoutMs / 1000)}s.`,
          });
        }
        if (wait.status === "error") {
          return jsonResult({
            status: "error",
            error: wait.error?.trim() || "Advisor run failed.",
          });
        }

        const advice = await captureSubagentCompletionReply(spawn.childSessionKey ?? "", {
          waitForReply: true,
          outcome: { status: "ok" },
        });

        if (!advice || !advice.trim()) {
          return jsonResult({
            status: "error",
            error: "Advisor produced no answer.",
          });
        }

        return jsonResult({ status: "ok", model: opts.model, advice: advice.trim() });
      } finally {
        await deleteAdvisorSession(spawn.childSessionKey);
      }
    },
  };
}
