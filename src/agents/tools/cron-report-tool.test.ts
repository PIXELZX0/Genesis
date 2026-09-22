import { describe, expect, it } from "vitest";
import "../test-helpers/fast-coding-tools.js";
import "../test-helpers/fast-genesis-tools.js";
import { createGenesisCodingTools } from "../pi-tools.js";
import { createCronReportTool, takeCronRunReport } from "./cron-report-tool.js";

describe("cron_report tool", () => {
  it("is only exposed to cron-triggered runs, even under a narrow tool profile", () => {
    const names = (trigger?: "cron" | "user") =>
      createGenesisCodingTools({
        trigger,
        runId: "run-1",
        config: { tools: { profile: "minimal" } },
      }).map((tool) => tool.name);
    expect(names("cron")).toContain("cron_report");
    expect(names("user")).not.toContain("cron_report");
    expect(names()).not.toContain("cron_report");
  });

  it("records the report for its run and hands it out once", async () => {
    await createCronReportTool({ runId: "run-2" }).execute("call-1", {
      status: "ok",
      result: "3 files synced",
    });
    expect(takeCronRunReport("run-2")).toEqual({ status: "ok", result: "3 files synced" });
    expect(takeCronRunReport("run-2")).toBeUndefined();
  });

  it("rejects unknown statuses", async () => {
    await expect(
      createCronReportTool({ runId: "run-3" }).execute("call-1", {
        status: "done",
        result: "x",
      }),
    ).rejects.toThrow("status must be one of ok, error");
    expect(takeCronRunReport("run-3")).toBeUndefined();
  });
});
