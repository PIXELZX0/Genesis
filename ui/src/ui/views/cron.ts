import { html, nothing } from "lit";
import { t } from "../../i18n/index.ts";
import type {
  CronFieldErrors,
  CronJobsLastStatusFilter,
  CronJobsScheduleKindFilter,
} from "../controllers/cron.ts";
import { formatRelativeTimestamp } from "../format.ts";
import { icons } from "../icons.ts";
import { formatCronSchedule } from "../presenter.ts";
import type { ChannelUiMetaEntry, CronJob, CronRunLogEntry, CronStatus } from "../types.ts";
import type {
  CronDeliveryStatus,
  CronJobsEnabledFilter,
  CronRunScope,
  CronRunsStatusValue,
  CronJobsSortBy,
  CronRunsStatusFilter,
  CronSortDir,
} from "../types.ts";
import type { CronFormState } from "../ui-types.ts";

// The controller still passes the full prop bag; the Pencil-design cron screen
// only consumes a subset (job list + search + quick-create). Job creation and
// editing live in the quick-create modal; unused callbacks stay on the type so
// the controller wiring stays valid.
export type CronProps = {
  basePath: string;
  loading: boolean;
  jobsLoadingMore: boolean;
  status: CronStatus | null;
  jobs: CronJob[];
  jobsTotal: number;
  jobsHasMore: boolean;
  jobsQuery: string;
  jobsEnabledFilter: CronJobsEnabledFilter;
  jobsScheduleKindFilter: CronJobsScheduleKindFilter;
  jobsLastStatusFilter: CronJobsLastStatusFilter;
  jobsSortBy: CronJobsSortBy;
  jobsSortDir: CronSortDir;
  error: string | null;
  busy: boolean;
  form: CronFormState;
  fieldErrors: CronFieldErrors;
  canSubmit: boolean;
  editingJobId: string | null;
  channels: string[];
  channelLabels?: Record<string, string>;
  channelMeta?: ChannelUiMetaEntry[];
  runsJobId: string | null;
  runs: CronRunLogEntry[];
  runsTotal: number;
  runsHasMore: boolean;
  runsLoadingMore: boolean;
  runsScope: CronRunScope;
  runsStatuses: CronRunsStatusValue[];
  runsDeliveryStatuses: CronDeliveryStatus[];
  runsStatusFilter: CronRunsStatusFilter;
  runsQuery: string;
  runsSortDir: CronSortDir;
  agentSuggestions: string[];
  modelSuggestions: string[];
  thinkingSuggestions: string[];
  timezoneSuggestions: string[];
  deliveryToSuggestions: string[];
  accountSuggestions: string[];
  onFormChange: (patch: Partial<CronFormState>) => void;
  onRefresh: () => void;
  onAdd: () => void;
  onEdit: (job: CronJob) => void;
  onClone: (job: CronJob) => void;
  onCancelEdit: () => void;
  onToggle: (job: CronJob, enabled: boolean) => void;
  onRun: (job: CronJob, mode?: "force" | "due") => void;
  onRemove: (job: CronJob) => void;
  /** Open the simplified creation wizard. */
  onQuickCreate?: () => void;
  onLoadRuns: (jobId: string) => void;
  onLoadMoreJobs: () => void;
  onJobsFiltersChange: (patch: {
    cronJobsQuery?: string;
    cronJobsEnabledFilter?: CronJobsEnabledFilter;
    cronJobsScheduleKindFilter?: CronJobsScheduleKindFilter;
    cronJobsLastStatusFilter?: CronJobsLastStatusFilter;
    cronJobsSortBy?: CronJobsSortBy;
    cronJobsSortDir?: CronSortDir;
  }) => void | Promise<void>;
  onJobsFiltersReset: () => void | Promise<void>;
  onLoadMoreRuns: () => void;
  onRunsFiltersChange: (patch: {
    cronRunsScope?: CronRunScope;
    cronRunsStatuses?: CronRunsStatusValue[];
    cronRunsDeliveryStatuses?: CronDeliveryStatus[];
    cronRunsStatusFilter?: CronRunsStatusFilter;
    cronRunsQuery?: string;
    cronRunsSortDir?: CronSortDir;
  }) => void | Promise<void>;
  onNavigateToChat?: (sessionKey: string) => void;
};

const CRON_GRID = "grid-template-columns: 130px 1fr 150px 110px 110px 120px;";

function formatStateRelative(ms?: number): string {
  if (typeof ms !== "number" || !Number.isFinite(ms)) {
    return t("common.na");
  }
  return formatRelativeTimestamp(ms);
}

function resolveAgent(props: CronProps, job: CronJob): string {
  if (!job.agentId) {
    return "—";
  }
  const meta = props.channelMeta?.find((entry) => entry.id === job.agentId);
  return meta?.label ?? props.channelLabels?.[job.agentId] ?? job.agentId;
}

function renderRow(job: CronJob, props: CronProps) {
  const dot = job.enabled ? "status-dot--ok" : "status-dot--idle";
  return html`
    <div
      class="table-row"
      style="cursor: pointer; ${CRON_GRID}"
      @click=${() => props.onLoadRuns(job.id)}
    >
      <span
        style="font-family: var(--mono); color: var(--text); display: flex; align-items: center; gap: 8px;"
      >
        <span class="status-dot ${dot}"></span>
        ${job.name}
      </span>
      <span class="muted" style="font-family: var(--mono);">${formatCronSchedule(job)}</span>
      <span class="muted">${resolveAgent(props, job)}</span>
      <span class="muted" style="font-family: var(--mono);"
        >${formatStateRelative(job.state?.nextRunAtMs)}</span
      >
      <span class="muted" style="font-family: var(--mono);"
        >${formatStateRelative(job.state?.lastRunAtMs)}</span
      >
      <span class="muted">${job.enabled ? "Active" : "Paused"}</span>
    </div>
  `;
}

export function renderCron(props: CronProps) {
  const jobs = props.jobs;
  const scheduled = jobs.filter((job) => job.enabled).length;
  const paused = jobs.length - scheduled;
  return html`
    <section class="card" style="border: none; background: transparent; padding: 0;">
      <div class="row" style="justify-content: space-between; align-items: flex-start; gap: 16px;">
        <div>
          <div class="view-title">${t("tabs.cron")}</div>
          <div class="view-sub">${scheduled} scheduled · ${paused} paused</div>
        </div>
        <div class="row" style="gap: 12px; flex: none;">
          <div class="data-table-search" style="width: 220px;">
            ${icons.search}
            <input
              type="search"
              .value=${props.jobsQuery}
              placeholder="Search jobs"
              @input=${(event: Event) =>
                props.onJobsFiltersChange({
                  cronJobsQuery: (event.target as HTMLInputElement).value,
                })}
            />
          </div>
          ${props.onQuickCreate
            ? html`
                <button class="btn primary" @click=${props.onQuickCreate}>
                  <span class="btn__icon">${icons.plus}</span>
                  New
                </button>
              `
            : nothing}
        </div>
      </div>

      ${props.error
        ? html`<div class="callout danger" style="margin-top: 16px;">${props.error}</div>`
        : nothing}
      ${jobs.length === 0
        ? html`<div class="muted" style="padding: 16px;">
            ${props.loading ? t("cron.jobs.loading") : t("cron.jobs.noMatching")}
          </div>`
        : html`
            <div class="table" style="margin-top: 20px;">
              <div class="table-head" style=${CRON_GRID}>
                <span>JOB</span>
                <span>SCHEDULE</span>
                <span>AGENT</span>
                <span>NEXT RUN</span>
                <span>LAST RUN</span>
                <span>STATUS</span>
              </div>
              ${jobs.map((job) => renderRow(job, props))}
            </div>
            ${props.jobsHasMore
              ? html`
                  <div class="row" style="margin-top: 12px;">
                    <button
                      class="btn"
                      ?disabled=${props.loading || props.jobsLoadingMore}
                      @click=${props.onLoadMoreJobs}
                    >
                      ${props.jobsLoadingMore ? t("cron.jobs.loading") : t("cron.jobs.loadMore")}
                    </button>
                  </div>
                `
              : nothing}
          `}
    </section>
  `;
}
