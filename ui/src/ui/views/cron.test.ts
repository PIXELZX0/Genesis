/* @vitest-environment jsdom */

import { render } from "lit";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_CRON_FORM } from "../app-defaults.ts";
import { withoutArrayCopyMethods } from "../test-helpers/array-copy-methods.ts";
import type { CronJob } from "../types.ts";
import { renderCron, type CronProps } from "./cron.ts";

function createJob(id: string, overrides: Partial<CronJob> = {}): CronJob {
  return {
    id,
    name: "Daily ping",
    enabled: true,
    createdAtMs: 0,
    updatedAtMs: 0,
    schedule: { kind: "cron", expr: "0 9 * * *" },
    sessionTarget: "main",
    wakeMode: "next-heartbeat",
    payload: { kind: "systemEvent", text: "ping" },
    ...overrides,
  };
}

function createProps(overrides: Partial<CronProps> = {}): CronProps {
  return {
    basePath: "",
    loading: false,
    jobsLoadingMore: false,
    status: null,
    jobs: [],
    jobsTotal: 0,
    jobsHasMore: false,
    jobsQuery: "",
    jobsEnabledFilter: "all",
    jobsScheduleKindFilter: "all",
    jobsLastStatusFilter: "all",
    jobsSortBy: "nextRunAtMs",
    jobsSortDir: "asc",
    error: null,
    busy: false,
    form: { ...DEFAULT_CRON_FORM },
    fieldErrors: {},
    canSubmit: true,
    editingJobId: null,
    channels: [],
    channelLabels: {},
    runsJobId: null,
    runs: [],
    runsTotal: 0,
    runsHasMore: false,
    runsLoadingMore: false,
    runsScope: "all",
    runsStatuses: [],
    runsDeliveryStatuses: [],
    runsStatusFilter: "all",
    runsQuery: "",
    runsSortDir: "desc",
    agentSuggestions: [],
    modelSuggestions: [],
    thinkingSuggestions: [],
    timezoneSuggestions: [],
    deliveryToSuggestions: [],
    accountSuggestions: [],
    onFormChange: () => undefined,
    onRefresh: () => undefined,
    onAdd: () => undefined,
    onEdit: () => undefined,
    onClone: () => undefined,
    onCancelEdit: () => undefined,
    onToggle: () => undefined,
    onRun: () => undefined,
    onRemove: () => undefined,
    onLoadRuns: () => undefined,
    onLoadMoreJobs: () => undefined,
    onJobsFiltersChange: () => undefined,
    onJobsFiltersReset: () => undefined,
    onLoadMoreRuns: () => undefined,
    onRunsFiltersChange: () => undefined,
    ...overrides,
  };
}

describe("cron view (Pencil design)", () => {
  it("renders the Pencil columns and a job row when array copy methods are unavailable", () => {
    const container = document.createElement("div");
    withoutArrayCopyMethods(() =>
      render(
        renderCron(createProps({ jobs: [createJob("job-1", { agentId: "ops" })] })),
        container,
      ),
    );

    const head = container.querySelector(".table-head");
    expect(head?.textContent).toContain("JOB");
    expect(head?.textContent).toContain("SCHEDULE");
    expect(head?.textContent).toContain("AGENT");
    expect(head?.textContent).toContain("NEXT RUN");
    expect(head?.textContent).toContain("LAST RUN");
    expect(head?.textContent).toContain("STATUS");
    expect(container.querySelectorAll(".table-row")).toHaveLength(1);
    expect(container.textContent).toContain("Daily ping");
    expect(container.textContent).toContain("0 9 * * *");
    expect(container.textContent).toContain("ops");
    expect(container.textContent).toContain("Active");
  });

  it("renders the title with scheduled/paused counts", () => {
    const container = document.createElement("div");
    render(
      renderCron(
        createProps({
          jobs: [
            createJob("job-1", { enabled: true }),
            createJob("job-2", { enabled: true }),
            createJob("job-3", { enabled: false }),
          ],
        }),
      ),
      container,
    );
    expect(container.querySelector(".view-title")?.textContent).toContain("Cron");
    expect(container.querySelector(".view-sub")?.textContent).toContain("2 scheduled · 1 paused");
    expect(container.textContent).toContain("Paused");
  });

  it("wires the search box to the jobs query filter", () => {
    const container = document.createElement("div");
    const onJobsFiltersChange = vi.fn();
    render(renderCron(createProps({ onJobsFiltersChange })), container);
    const input = container.querySelector<HTMLInputElement>(".data-table-search input");
    expect(input).not.toBeNull();
    if (!input) {
      return;
    }
    input.value = "digest";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(onJobsFiltersChange).toHaveBeenCalledWith({ cronJobsQuery: "digest" });
  });

  it("opens the quick-create modal from the New button and loads runs on row click", () => {
    const container = document.createElement("div");
    const onQuickCreate = vi.fn();
    const onLoadRuns = vi.fn();
    render(
      renderCron(createProps({ jobs: [createJob("job-1")], onQuickCreate, onLoadRuns })),
      container,
    );

    const newButton = Array.from(container.querySelectorAll("button")).find((btn) =>
      btn.textContent?.includes("New"),
    );
    expect(newButton).not.toBeUndefined();
    newButton?.click();
    expect(onQuickCreate).toHaveBeenCalledTimes(1);

    container.querySelector<HTMLElement>(".table-row")?.click();
    expect(onLoadRuns).toHaveBeenCalledWith("job-1");
  });
});
