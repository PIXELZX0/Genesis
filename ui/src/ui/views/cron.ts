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

const CRON_GRID =
  "grid-template-columns: minmax(180px, 1.8fr) minmax(150px, 1.4fr) 140px 110px 110px 100px;";

// Grid cells default to `min-width: auto`, so long job names / cron expressions
// overflow into the neighbouring column instead of truncating. Force shrinkable
// cells with an ellipsis so JOB and SCHEDULE never collide.
const CELL_ELLIPSIS =
  "min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;";

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
      title=${`Edit ${job.name}`}
      @click=${() => props.onEdit(job)}
    >
      <span
        style="font-family: var(--mono); color: var(--text); display: flex; align-items: center; gap: 8px; min-width: 0;"
      >
        <span class="status-dot ${dot}" style="flex: none;"></span>
        <span style=${CELL_ELLIPSIS}>${job.name}</span>
      </span>
      <span class="muted" style="font-family: var(--mono); ${CELL_ELLIPSIS}"
        >${formatCronSchedule(job)}</span
      >
      <span class="muted" style=${CELL_ELLIPSIS}>${resolveAgent(props, job)}</span>
      <span class="muted" style="font-family: var(--mono); ${CELL_ELLIPSIS}"
        >${formatStateRelative(job.state?.nextRunAtMs)}</span
      >
      <span class="muted" style="font-family: var(--mono); ${CELL_ELLIPSIS}"
        >${formatStateRelative(job.state?.lastRunAtMs)}</span
      >
      <span class="muted" style=${CELL_ELLIPSIS}>${job.enabled ? "Active" : "Paused"}</span>
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
      ${renderCronEditModal(props)}
    </section>
  `;
}

function field<K extends keyof CronFormState>(props: CronProps, key: K, value: CronFormState[K]) {
  props.onFormChange({ [key]: value } as Partial<CronFormState>);
}

function renderScheduleFields(props: CronProps) {
  const form = props.form;
  if (form.scheduleKind === "cron") {
    return html`
      <label class="cron-edit__field">
        <span class="cron-edit__label">Cron expression</span>
        <input
          class="input"
          .value=${form.cronExpr}
          placeholder="0 9 * * *"
          @input=${(e: Event) => field(props, "cronExpr", (e.target as HTMLInputElement).value)}
        />
        ${props.fieldErrors.cronExpr
          ? html`<span class="cron-edit__error">${props.fieldErrors.cronExpr}</span>`
          : nothing}
      </label>
      <label class="cron-edit__field">
        <span class="cron-edit__label">Timezone (optional)</span>
        <input
          class="input"
          .value=${form.cronTz}
          placeholder="UTC"
          @input=${(e: Event) => field(props, "cronTz", (e.target as HTMLInputElement).value)}
        />
      </label>
    `;
  }
  if (form.scheduleKind === "every") {
    return html`
      <div class="row" style="gap: 12px; align-items: flex-end;">
        <label class="cron-edit__field" style="flex: 1;">
          <span class="cron-edit__label">Every</span>
          <input
            class="input"
            type="number"
            min="1"
            .value=${form.everyAmount}
            @input=${(e: Event) =>
              field(props, "everyAmount", (e.target as HTMLInputElement).value)}
          />
        </label>
        <label class="cron-edit__field" style="flex: 1;">
          <span class="cron-edit__label">Unit</span>
          <select
            class="input"
            .value=${form.everyUnit}
            @change=${(e: Event) =>
              field(
                props,
                "everyUnit",
                (e.target as HTMLSelectElement).value as typeof form.everyUnit,
              )}
          >
            <option value="minutes">minutes</option>
            <option value="hours">hours</option>
            <option value="days">days</option>
          </select>
        </label>
      </div>
      ${props.fieldErrors.everyAmount
        ? html`<span class="cron-edit__error">${props.fieldErrors.everyAmount}</span>`
        : nothing}
    `;
  }
  return html`
    <label class="cron-edit__field">
      <span class="cron-edit__label">Run at</span>
      <input
        class="input"
        type="datetime-local"
        .value=${form.scheduleAt}
        @input=${(e: Event) => field(props, "scheduleAt", (e.target as HTMLInputElement).value)}
      />
      ${props.fieldErrors.scheduleAt
        ? html`<span class="cron-edit__error">${props.fieldErrors.scheduleAt}</span>`
        : nothing}
    </label>
  `;
}

function renderCronEditModal(props: CronProps) {
  if (!props.editingJobId) {
    return nothing;
  }
  const form = props.form;
  const editingJob = props.jobs.find((job) => job.id === props.editingJobId);
  const scheduleKinds: Array<CronFormState["scheduleKind"]> = ["cron", "every", "at"];
  const scheduleLabels: Record<CronFormState["scheduleKind"], string> = {
    cron: "Cron",
    every: "Interval",
    at: "Once",
  };
  return html`
    <div class="exec-approval-overlay" role="dialog" aria-modal="true">
      <div class="exec-approval-card cron-edit-card">
        <div class="exec-approval-header">
          <div>
            <div class="exec-approval-title">Edit job</div>
            <div class="exec-approval-sub">
              ${form.name || editingJob?.name || props.editingJobId}
            </div>
          </div>
          <button class="icon-btn" aria-label="Close" @click=${props.onCancelEdit}>
            ${icons.x}
          </button>
        </div>

        ${props.error
          ? html`<div class="callout danger" style="margin: 0 0 12px;">${props.error}</div>`
          : nothing}

        <div class="cron-edit__body">
          <label class="cron-edit__field">
            <span class="cron-edit__label">Name</span>
            <input
              class="input"
              .value=${form.name}
              @input=${(e: Event) => field(props, "name", (e.target as HTMLInputElement).value)}
            />
            ${props.fieldErrors.name
              ? html`<span class="cron-edit__error">${props.fieldErrors.name}</span>`
              : nothing}
          </label>

          <label class="cron-edit__field">
            <span class="cron-edit__label">Prompt</span>
            <textarea
              class="input"
              rows="3"
              .value=${form.payloadText}
              @input=${(e: Event) =>
                field(props, "payloadText", (e.target as HTMLTextAreaElement).value)}
            ></textarea>
          </label>

          <label class="cron-edit__field">
            <span class="cron-edit__label">Agent (optional)</span>
            <input
              class="input"
              list="cron-edit-agents"
              .value=${form.agentId}
              placeholder="default"
              @input=${(e: Event) => field(props, "agentId", (e.target as HTMLInputElement).value)}
            />
            <datalist id="cron-edit-agents">
              ${props.agentSuggestions.map((a) => html`<option value=${a}></option>`)}
            </datalist>
          </label>

          <div class="cron-edit__field">
            <span class="cron-edit__label">Schedule</span>
            <div class="cron-edit__segmented">
              ${scheduleKinds.map(
                (kind) => html`
                  <button
                    class=${form.scheduleKind === kind
                      ? "cron-edit__seg cron-edit__seg--active"
                      : "cron-edit__seg"}
                    @click=${() => field(props, "scheduleKind", kind)}
                  >
                    ${scheduleLabels[kind]}
                  </button>
                `,
              )}
            </div>
          </div>
          ${renderScheduleFields(props)}

          <label class="cron-edit__checkbox">
            <input
              type="checkbox"
              .checked=${form.enabled}
              @change=${(e: Event) =>
                field(props, "enabled", (e.target as HTMLInputElement).checked)}
            />
            <span>Enabled</span>
          </label>
        </div>

        <div class="exec-approval-actions" style="justify-content: space-between;">
          <div class="row" style="gap: 8px;">
            ${editingJob
              ? html`
                  <button
                    class="btn"
                    ?disabled=${props.busy}
                    @click=${() => props.onRun(editingJob, "force")}
                  >
                    Run now
                  </button>
                  <button
                    class="btn danger"
                    ?disabled=${props.busy}
                    @click=${() => props.onRemove(editingJob)}
                  >
                    Delete
                  </button>
                `
              : nothing}
          </div>
          <div class="row" style="gap: 8px;">
            <button class="btn" ?disabled=${props.busy} @click=${props.onCancelEdit}>
              ${t("common.cancel")}
            </button>
            <button
              class="btn primary"
              ?disabled=${props.busy || !props.canSubmit}
              @click=${props.onAdd}
            >
              ${props.busy ? t("common.working") : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  `;
}
