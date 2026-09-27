import { html, nothing } from "lit";
import { t } from "../../i18n/index.ts";
import type { EventLogEntry } from "../app-events.ts";
import { formatCost, formatDurationHuman, formatTokens } from "../format.ts";
import type { GatewayHelloOk } from "../gateway.ts";
import type { UiSettings } from "../storage.ts";
import type {
  AttentionItem,
  CronJob,
  CronStatus,
  ModelAuthStatusResult,
  SessionsListResult,
  SessionsUsageResult,
  SkillStatusReport,
  WalletSummaryResult,
} from "../types.ts";

// The controller passes the full prop bag; the Pencil-design overview only
// consumes a subset (stats + recent activity + status). Unused fields/callbacks
// are kept on the type so the controller wiring stays valid.
// Each step is null when its state is unknown (e.g. an older gateway), so the
// checklist never nags about something it could not verify.
export type OverviewSetupState = {
  modelReady: boolean | null;
  defaultModelLabel: string | null;
  channelReady: boolean | null;
  chatReady: boolean | null;
};

export type OverviewProps = {
  connected: boolean;
  setup: OverviewSetupState;
  hello: GatewayHelloOk | null;
  settings: UiSettings;
  password: string;
  lastError: string | null;
  lastErrorCode: string | null;
  onlineChannelCount: number;
  sessionsCount: number | null;
  cronEnabled: boolean | null;
  cronNext: number | null;
  lastChannelsRefresh: number | null;
  warnQueryToken: boolean;
  modelAuthStatus: ModelAuthStatusResult | null;
  usageResult: SessionsUsageResult | null;
  sessionsResult: SessionsListResult | null;
  skillsReport: SkillStatusReport | null;
  cronJobs: CronJob[];
  cronStatus: CronStatus | null;
  walletSummary: WalletSummaryResult | null;
  walletSummaryError: string | null;
  attentionItems: AttentionItem[];
  eventLog: EventLogEntry[];
  overviewLogLines: string[];
  showGatewayToken: boolean;
  showGatewayPassword: boolean;
  onSettingsChange: (next: UiSettings) => void;
  onPasswordChange: (next: string) => void;
  onSessionKeyChange: (next: string) => void;
  onToggleGatewayTokenVisibility: () => void;
  onToggleGatewayPasswordVisibility: () => void;
  onConnect: () => void;
  onRefresh: () => void;
  onNavigate: (tab: string) => void;
  onRefreshLogs: () => void;
};

function severityDot(severity: AttentionItem["severity"]): string {
  if (severity === "error") {
    return "status-dot--error";
  }
  if (severity === "warning") {
    return "status-dot--idle";
  }
  return "status-dot--ok";
}

function statCell(value: string, label: string, last = false) {
  const border = last ? "" : "border-right: 1px solid var(--border);";
  return html`
    <div
      style="display: flex; flex-direction: column; gap: 4px; padding: 16px 20px; flex: 1; ${border}"
    >
      <div style="font-size: 28px; font-weight: 600; line-height: 1.1; color: var(--text);">
        ${value}
      </div>
      <div class="muted" style="font-size: 13px;">${label}</div>
    </div>
  `;
}

type SetupStep = {
  done: boolean;
  title: string;
  description: string;
  action: string;
  tab: string;
};

function resolveSetupSteps(setup: OverviewSetupState): SetupStep[] {
  const model = setup.defaultModelLabel ?? t("overview.setup.defaultModel");
  const steps: Array<SetupStep | null> = [
    setup.modelReady === null
      ? null
      : {
          done: setup.modelReady,
          title: t("overview.setup.modelTitle"),
          description: setup.modelReady
            ? t("overview.setup.modelDone", { model })
            : t("overview.setup.modelTodo", { model }),
          action: t("overview.setup.modelAction"),
          tab: "config",
        },
    setup.channelReady === null
      ? null
      : {
          done: setup.channelReady,
          title: t("overview.setup.channelTitle"),
          description: t("overview.setup.channelDesc"),
          action: t("overview.setup.channelAction"),
          tab: "channels",
        },
    setup.chatReady === null
      ? null
      : {
          done: setup.chatReady,
          title: t("overview.setup.chatTitle"),
          description: t("overview.setup.chatDesc"),
          action: t("overview.setup.chatAction"),
          tab: "chat",
        },
  ];
  return steps.filter((step): step is SetupStep => step !== null);
}

function renderSetupChecklist(setup: OverviewSetupState, onNavigate: (tab: string) => void) {
  const steps = resolveSetupSteps(setup);
  const doneCount = steps.filter((step) => step.done).length;
  if (steps.length === 0 || doneCount === steps.length) {
    return nothing;
  }
  // The first unfinished step gets the primary button; later ones stay quiet.
  const nextIndex = steps.findIndex((step) => !step.done);
  return html`
    <div class="card overview-setup" style="margin-top: 24px;">
      <div class="panel-label">
        ${t("overview.setup.title", { done: String(doneCount), total: String(steps.length) })}
      </div>
      ${steps.map(
        (step, index) => html`
          <div class="panel-row">
            <span
              class="status-dot ${step.done ? "status-dot--ok" : "status-dot--off"}"
              style="flex: none;"
            ></span>
            <div style="min-width: 0; flex: 1;">
              <div
                style="color: var(--text); ${step.done
                  ? "text-decoration: line-through; opacity: 0.6;"
                  : ""}"
              >
                ${step.title}
              </div>
              <div class="muted" style="font-size: 13px;">${step.description}</div>
            </div>
            ${step.done
              ? nothing
              : html`<button
                  class="btn btn--sm ${index === nextIndex ? "primary" : ""}"
                  @click=${() => onNavigate(step.tab)}
                >
                  ${step.action}
                </button>`}
          </div>
        `,
      )}
    </div>
  `;
}

const USAGE_CHART_DAYS = 14;
const USAGE_CHART_HEIGHT_PX = 120;

function usageChart(usage: SessionsUsageResult | null, onNavigate: (tab: string) => void) {
  const daily = (usage?.aggregates?.daily ?? []).slice(-USAGE_CHART_DAYS);
  // An empty chart on a fresh install is just noise; the Usage tab stays reachable.
  if (daily.length === 0) {
    return nothing;
  }
  const totalTokens = daily.reduce((sum, d) => sum + d.tokens, 0);
  const totalCost = daily.reduce((sum, d) => sum + d.cost, 0);
  const maxTokens = Math.max(...daily.map((d) => d.tokens), 1);
  return html`
    <div class="card" style="margin-top: 24px;">
      <div style="display: flex; justify-content: space-between; align-items: baseline; gap: 12px;">
        <div class="panel-label">
          ${t("overview.panels.usage", { days: String(USAGE_CHART_DAYS) })}
        </div>
        <button
          class="btn btn--sm"
          style="margin-bottom: 12px;"
          @click=${() => onNavigate("usage")}
        >
          ${t("tabs.usage")}
        </button>
      </div>
      <div
        style="display: flex; align-items: flex-end; gap: 6px; height: ${USAGE_CHART_HEIGHT_PX}px; --bar-max-width: 32px;"
      >
        ${daily.map((d) => {
          const heightPx = (d.tokens / maxTokens) * USAGE_CHART_HEIGHT_PX;
          return html`
            <div
              style="flex: 1; display: flex; flex-direction: column; justify-content: flex-end; align-items: center; height: 100%;"
              title="${d.date} · ${formatTokens(d.tokens)} tokens · ${formatCost(d.cost)}"
            >
              ${d.tokens > 0
                ? html`<div class="daily-bar" style="height: ${heightPx.toFixed(0)}px"></div>`
                : nothing}
            </div>
          `;
        })}
      </div>
      <div style="display: flex; gap: 6px; margin-top: 6px;">
        ${daily.map(
          (d) => html`
            <div
              class="muted"
              style="flex: 1; text-align: center; font-size: 11px; font-family: var(--mono);"
            >
              ${Number.parseInt(d.date.slice(8), 10)}
            </div>
          `,
        )}
      </div>
      <div
        class="muted"
        style="display: flex; gap: 16px; margin-top: 12px; font-family: var(--mono); font-size: 13px;"
      >
        <span>${formatTokens(totalTokens)} tokens</span>
        <span>${formatCost(totalCost)}</span>
      </div>
    </div>
  `;
}

export function renderOverview(props: OverviewProps) {
  const snapshot = props.hello?.snapshot as { uptimeMs?: number } | undefined;
  const uptime = snapshot?.uptimeMs ? formatDurationHuman(snapshot.uptimeMs) : t("common.na");
  const version = props.hello?.server?.version ?? t("common.na");
  const activity = props.attentionItems.slice(0, 6);
  const statusRows: Array<{ label: string; value: string; ok: boolean | null }> = [
    {
      label: t("overview.stats.gateway"),
      value: props.connected ? t("common.online") : t("common.offline"),
      ok: props.connected,
    },
    {
      label: t("overview.stats.cron"),
      value: props.cronEnabled ? t("common.enabled") : t("common.disabled"),
      ok: props.cronEnabled ?? false,
    },
    {
      label: t("overview.stats.activeSessions"),
      value: String(props.sessionsCount ?? 0),
      ok: null,
    },
    {
      label: t("overview.stats.onlineChannels"),
      value: String(props.onlineChannelCount),
      ok: null,
    },
    { label: t("common.version"), value: version, ok: null },
  ];

  return html`
    <section class="card" style="border: none; background: transparent; padding: 0;">
      <div>
        <div class="view-title">${t("tabs.overview")}</div>
        <div class="view-sub">${t("subtitles.overview")}</div>
      </div>

      ${renderSetupChecklist(props.setup, props.onNavigate)}

      <div class="card" style="display: flex; padding: 0; margin-top: 24px; overflow: hidden;">
        ${statCell(String(props.sessionsCount ?? 0), t("overview.stats.activeSessions"))}
        ${statCell(String(props.onlineChannelCount), t("overview.stats.onlineChannels"))}
        ${statCell(String(props.cronJobs.length), t("overview.stats.cronJobs"))}
        ${statCell(uptime, t("overview.stats.uptime"), true)}
      </div>

      ${usageChart(props.usageResult, props.onNavigate)}

      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 24px;">
        <div class="card">
          <div class="panel-label">${t("overview.panels.recentActivity")}</div>
          ${activity.length === 0
            ? html`<div class="muted" style="padding: 8px 0;">
                ${t("overview.panels.allClear")}
              </div>`
            : activity.map(
                (item) => html`
                  <div class="panel-row">
                    <span
                      class="status-dot ${severityDot(item.severity)}"
                      style="margin-top: 6px; flex: none;"
                    ></span>
                    <div style="min-width: 0; flex: 1;">
                      <div style="color: var(--text);">${item.title}</div>
                      <div class="muted" style="font-size: 13px;">${item.description}</div>
                    </div>
                  </div>
                `,
              )}
        </div>

        <div class="card">
          <div class="panel-label">${t("overview.panels.status")}</div>
          ${statusRows.map(
            (row) => html`
              <div class="panel-row">
                <span class="muted">${row.label}</span>
                <span
                  style="display: flex; align-items: center; gap: 8px; font-family: var(--mono);"
                >
                  ${row.ok === null
                    ? nothing
                    : html`<span
                        class="status-dot ${row.ok ? "status-dot--ok" : "status-dot--idle"}"
                      ></span>`}
                  ${row.value}
                </span>
              </div>
            `,
          )}
        </div>
      </div>

      <div class="card" style="margin-top: 24px;">
        <div class="panel-label">${t("overview.panels.connection")}</div>
        <div
          style="display: grid; grid-template-columns: 2fr 1fr auto; gap: 12px; align-items: end;"
        >
          <label class="field">
            <span>${t("overview.access.wsUrl")}</span>
            <input
              .value=${props.settings.gatewayUrl}
              @input=${(e: Event) => {
                const v = (e.target as HTMLInputElement).value;
                props.onSettingsChange({
                  ...props.settings,
                  gatewayUrl: v,
                  token: v.trim() === props.settings.gatewayUrl.trim() ? props.settings.token : "",
                });
              }}
              placeholder="ws://100.x.y.z:18789"
            />
          </label>
          <label class="field">
            <span>${t("overview.access.token")}</span>
            <input
              type="password"
              autocomplete="off"
              .value=${props.settings.token}
              @input=${(e: Event) =>
                props.onSettingsChange({
                  ...props.settings,
                  token: (e.target as HTMLInputElement).value,
                })}
              placeholder="GENESIS_GATEWAY_TOKEN"
            />
          </label>
          <button class="btn primary" @click=${props.onConnect}>
            ${props.connected ? t("common.connected") : t("common.connect")}
          </button>
        </div>
      </div>
    </section>
  `;
}
