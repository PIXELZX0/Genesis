import { Type } from "typebox";
import { stringEnum } from "../schema/typebox.js";
import { type AnyAgentTool, ToolInputError, jsonResult, readStringParam } from "./common.js";

export const CRON_REPORT_TOOL_NAME = "cron_report";

const CRON_REPORT_STATUSES = ["ok", "error"] as const;

export type CronRunReport = {
  status: (typeof CRON_REPORT_STATUSES)[number];
  result: string;
};

// Keyed by embedded runId; cron finalize takes the entry once the run ends.
const reportsByRunId = new Map<string, CronRunReport>();

export function peekCronRunReport(runId: string): CronRunReport | undefined {
  return reportsByRunId.get(runId);
}

export function takeCronRunReport(runId: string): CronRunReport | undefined {
  const report = reportsByRunId.get(runId);
  reportsByRunId.delete(runId);
  return report;
}

const CronReportToolSchema = Type.Object({
  status: stringEnum(CRON_REPORT_STATUSES, {
    description: '"ok" when the job succeeded, "error" when it failed.',
  }),
  result: Type.String({
    description:
      "Full final job output, delivered as-is to the job's delivery target. Keep structure and details; do not condense.",
  }),
});

export function createCronReportTool(params: { runId: string }): AnyAgentTool {
  return {
    label: "Cron Report",
    name: CRON_REPORT_TOOL_NAME,
    displaySummary: "Report cron job status",
    description:
      "Report the final status and result of this cron job. Call once when the job is done. Use this instead of the message tool or a plain-text reply to report job status; the result is delivered automatically.",
    parameters: CronReportToolSchema,
    execute: async (_toolCallId, args) => {
      const input = args as Record<string, unknown>;
      const status = readStringParam(input, "status", { required: true });
      if (!CRON_REPORT_STATUSES.includes(status as CronRunReport["status"])) {
        throw new ToolInputError(`status must be one of ${CRON_REPORT_STATUSES.join(", ")}`);
      }
      const result = readStringParam(input, "result", { required: true });
      reportsByRunId.set(params.runId, { status: status as CronRunReport["status"], result });
      return jsonResult({ status: "recorded" });
    },
  };
}
