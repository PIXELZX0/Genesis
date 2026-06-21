import { html, nothing } from "lit";
import { t } from "../../i18n/index.ts";
import { formatRelativeTimestamp } from "../format.ts";
import { icons } from "../icons.ts";
import { pathForTab } from "../navigation.ts";
import { formatSessionTokens } from "../presenter.ts";
import { normalizeLowercaseStringOrEmpty } from "../string-coerce.ts";
import type {
  GatewaySessionRow,
  SessionCompactionCheckpoint,
  SessionsListResult,
} from "../types.ts";

// The controller still passes the full prop bag; the Pencil-design sessions
// screen only consumes a subset (list + search + chat navigation). Unused
// callbacks are kept on the type so the controller wiring stays valid.
export type SessionsProps = {
  loading: boolean;
  result: SessionsListResult | null;
  error: string | null;
  activeMinutes: string;
  limit: string;
  includeGlobal: boolean;
  includeUnknown: boolean;
  basePath: string;
  searchQuery: string;
  sortColumn: "key" | "kind" | "updated" | "tokens";
  sortDir: "asc" | "desc";
  page: number;
  pageSize: number;
  selectedKeys: Set<string>;
  expandedCheckpointKey: string | null;
  checkpointItemsByKey: Record<string, SessionCompactionCheckpoint[]>;
  checkpointLoadingKey: string | null;
  checkpointBusyKey: string | null;
  checkpointErrorByKey: Record<string, string>;
  onFiltersChange: (next: {
    activeMinutes: string;
    limit: string;
    includeGlobal: boolean;
    includeUnknown: boolean;
  }) => void;
  onSearchChange: (query: string) => void;
  onSortChange: (column: "key" | "kind" | "updated" | "tokens", dir: "asc" | "desc") => void;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  onRefresh: () => void;
  onPatch: (
    key: string,
    patch: {
      label?: string | null;
      thinkingLevel?: string | null;
      fastMode?: boolean | null;
      verboseLevel?: string | null;
      reasoningLevel?: string | null;
    },
  ) => void;
  onToggleSelect: (key: string) => void;
  onSelectPage: (keys: string[]) => void;
  onDeselectPage: (keys: string[]) => void;
  onDeselectAll: () => void;
  onDeleteSelected: () => void;
  onNavigateToChat?: (sessionKey: string) => void;
  onToggleCheckpointDetails: (sessionKey: string) => void;
  onBranchFromCheckpoint: (sessionKey: string, checkpointId: string) => void | Promise<void>;
  onRestoreCheckpoint: (sessionKey: string, checkpointId: string) => void | Promise<void>;
};

const SESSIONS_GRID = "grid-template-columns: 1.4fr 1.4fr 1fr 0.9fr 0.8fr 0.9fr;";
const ACTIVE_WINDOW_MS = 30 * 60 * 1000;

function filterRows(rows: readonly GatewaySessionRow[], query: string): GatewaySessionRow[] {
  const q = normalizeLowercaseStringOrEmpty(query);
  if (!q) {
    return [...rows];
  }
  return rows.filter((row) => {
    const key = normalizeLowercaseStringOrEmpty(row.key);
    const label = normalizeLowercaseStringOrEmpty(row.label);
    const kind = normalizeLowercaseStringOrEmpty(row.kind);
    const displayName = normalizeLowercaseStringOrEmpty(row.displayName);
    return key.includes(q) || label.includes(q) || kind.includes(q) || displayName.includes(q);
  });
}

function isActive(row: GatewaySessionRow): boolean {
  return row.updatedAt != null && Date.now() - row.updatedAt < ACTIVE_WINDOW_MS;
}

function renderRow(row: GatewaySessionRow, props: SessionsProps) {
  const active = isActive(row);
  const agent = row.displayName || row.label || row.spawnedBy || "—";
  const channel = row.surface || row.kind || "—";
  const updated = row.updatedAt ? formatRelativeTimestamp(row.updatedAt) : t("common.na");
  const tokens = formatSessionTokens(row);
  const chatUrl = `${pathForTab("chat", props.basePath)}?session=${encodeURIComponent(row.key)}`;
  return html`
    <a
      class="table-row"
      style=${SESSIONS_GRID}
      href=${chatUrl}
      @click=${(event: MouseEvent) => {
        if (
          event.defaultPrevented ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey ||
          !props.onNavigateToChat
        ) {
          return;
        }
        event.preventDefault();
        props.onNavigateToChat(row.key);
      }}
    >
      <span
        style="font-family: var(--mono); color: var(--text); display: flex; align-items: center; gap: 8px;"
      >
        <span class="status-dot ${active ? "status-dot--ok" : "status-dot--idle"}"></span>
        ${row.key}
      </span>
      <span>${agent}</span>
      <span class="muted">${channel}</span>
      <span class="muted" style="font-family: var(--mono);">${updated}</span>
      <span class="muted" style="font-family: var(--mono);">${tokens}</span>
      <span class="muted">${active ? "Active" : "Idle"}</span>
    </a>
  `;
}

export function renderSessions(props: SessionsProps) {
  const rows = filterRows(props.result?.sessions ?? [], props.searchQuery);
  const activeCount = rows.filter(isActive).length;
  const idleCount = rows.length - activeCount;
  return html`
    <section class="card" style="border: none; background: transparent; padding: 0;">
      <div class="row" style="justify-content: space-between; align-items: flex-start; gap: 16px;">
        <div>
          <div class="card-title">${t("tabs.sessions")}</div>
          <div class="card-sub">${activeCount} active · ${idleCount} idle</div>
        </div>
        <div class="data-table-search" style="width: 220px; flex: none;">
          ${icons.search}
          <input
            type="search"
            .value=${props.searchQuery}
            placeholder="Search sessions"
            @input=${(event: Event) =>
              props.onSearchChange((event.target as HTMLInputElement).value)}
          />
        </div>
      </div>

      ${props.error
        ? html`<div class="callout danger" style="margin-top: 16px;">${props.error}</div>`
        : nothing}
      ${rows.length === 0
        ? html`<div class="muted" style="padding: 16px;">
            ${props.loading ? t("common.loading") : t("common.na")}
          </div>`
        : html`
            <div class="table" style="margin-top: 20px;">
              <div class="table-head" style=${SESSIONS_GRID}>
                <span>SESSION</span>
                <span>AGENT</span>
                <span>CHANNEL</span>
                <span>UPDATED</span>
                <span>TOKENS</span>
                <span>STATUS</span>
              </div>
              ${rows.map((row) => renderRow(row, props))}
            </div>
          `}
    </section>
  `;
}
