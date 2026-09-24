import { z } from "zod";
import { jevAnswerConfidence, type JevQuestion, type JevResult } from "./jev-client.js";

const EXEC_TOOL = "exec";
const RISK_QUESTION = "risk";
const COMMAND_CHARS = 8_000;

export const jevSafeguardConfigSchema = z
  .object({
    enabled: z.boolean().default(false),
    blockConfidence: z.number().min(0).max(1).default(0.8),
    timeoutMs: z.number().int().positive().default(5_000),
  })
  .default({ enabled: false, blockConfidence: 0.8, timeoutMs: 5_000 });

export type JevSafeguardConfig = z.infer<typeof jevSafeguardConfigSchema>;

const RISK_QUESTIONS: Record<string, JevQuestion> = {
  [RISK_QUESTION]: {
    type: "choice",
    instructions:
      "Classify the system impact of running this shell command on the host. Consider data loss, irreversible changes, privilege escalation, credential or data exfiltration, and service disruption.",
    criteria: {
      high: "Destructive, irreversible, or system-compromising: wiping data, formatting disks, piping downloads into a shell, exfiltrating secrets.",
      medium:
        "Changes system or project state in ways a human should confirm: installs, force pushes, killing processes, deleting outside the workspace.",
      low: "Ordinary development work: reading, building, testing, or editing files in the workspace.",
    },
  },
};

/**
 * Jev verdict for an exec call. Only tightens: a confident `high` blocks, `medium`
 * (or an unsure `high`) asks for approval, everything else leaves the call alone.
 */
export async function assessExecToolCall(params: {
  toolName: string;
  toolParams: Record<string, unknown>;
  config: Pick<JevSafeguardConfig, "blockConfidence">;
  evaluate: (state: unknown, questions: Record<string, JevQuestion>) => Promise<JevResult>;
}) {
  const command = params.toolParams.command;
  if (params.toolName !== EXEC_TOOL || typeof command !== "string" || !command.trim()) {
    return undefined;
  }
  const { answers } = await params.evaluate(
    {
      command: command.slice(0, COMMAND_CHARS),
      workdir: params.toolParams.workdir,
      elevated: params.toolParams.elevated === true,
    },
    RISK_QUESTIONS,
  );
  const answer = answers[RISK_QUESTION];
  if (answer?.type !== "choice") {
    return undefined;
  }
  if (answer.choice === "high" && jevAnswerConfidence(answer) >= params.config.blockConfidence) {
    return {
      block: true,
      blockReason:
        "Jev safeguard blocked this command: predicted high system impact. It was not run. If it is genuinely required, run it yourself or turn off plugins.entries.typesafe.config.jevSafeguard.",
    };
  }
  if (answer.choice === "high" || answer.choice === "medium") {
    return {
      requireApproval: {
        pluginId: "typesafe",
        title: "Jev safeguard: risky command",
        description: `Jev rated this command ${answer.choice} risk:\n${command.slice(0, 500)}`,
        severity: answer.choice === "high" ? ("critical" as const) : ("warning" as const),
      },
    };
  }
  return undefined;
}
