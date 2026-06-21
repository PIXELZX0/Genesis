import { html, nothing } from "lit";
import { t } from "../../i18n/index.ts";
import type { EventLogEntry } from "../app-events.ts";
import { formatDurationHuman } from "../format.ts";
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
export type OverviewProps = {
  connected: boolean;
  hello: GatewayHelloOk | null;
  settings: UiSettings;
  password: string;
  lastError: string | null;
  lastErrorCode: string | null;
  presenceCount: number;
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

const PANEL_LABEL =
  "font-family: var(--mono); font-size: 11px; letter-spacing: 0.5px; text-transform: uppercase; color: var(--text-tertiary, #6b6b6b); margin-bottom: 12px;";
const ROW =
  "display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 10px 0; border-bottom: 1px solid var(--border);";

function severityDot(severity: AttentionItem["severity"]): string {
  if (severity === "error") {
    return "status-dot--error";
  }
  if (severity === "warn") {
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

export function renderOverview(props: OverviewProps) {
  const snapshot = props.hello?.snapshot as { uptimeMs?: number } | undefined;
  const uptime = snapshot?.uptimeMs ? formatDurationHuman(snapshot.uptimeMs) : t("common.na");
  const version = props.hello?.server?.version ?? t("common.na");
  const activity = props.attentionItems.slice(0, 6);
  const statusRows: Array<{ label: string; value: string; ok: boolean | null }> = [
    { label: "Gateway", value: props.connected ? "Online" : "Offline", ok: props.connected },
    {
      label: "Cron",
      value: props.cronEnabled ? "Enabled" : "Disabled",
      ok: props.cronEnabled ?? false,
    },
    { label: "Active sessions", value: String(props.sessionsCount ?? 0), ok: null },
    { label: "Channels online", value: String(props.presenceCount), ok: null },
    { label: "Version", value: version, ok: null },
  ];

  return html`
    <section class="card" style="border: none; background: transparent; padding: 0;">
      <div>
        <div class="view-title">${t("tabs.overview")}</div>
        <div class="view-sub">${t("subtitles.overview")}</div>
      </div>

      <div class="card" style="display: flex; padding: 0; margin-top: 24px; overflow: hidden;">
        ${statCell(String(props.sessionsCount ?? 0), "Active sessions")}
        ${statCell(String(props.presenceCount), "Online channels")}
        ${statCell(String(props.cronJobs.length), "Cron jobs")} ${statCell(uptime, "Uptime", true)}
      </div>

      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 24px;">
        <div class="card">
          <div style=${PANEL_LABEL}>RECENT ACTIVITY</div>
          ${activity.length === 0
            ? html`<div class="muted" style="padding: 8px 0;">${t("common.na")}</div>`
            : activity.map(
                (item) => html`
                  <div style="display: flex; gap: 12px; align-items: flex-start; ${ROW}">
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
          <div style=${PANEL_LABEL}>STATUS</div>
          ${statusRows.map(
            (row) => html`
              <div style=${ROW}>
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
    </section>
  `;
}
