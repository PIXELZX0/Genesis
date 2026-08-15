import { html, nothing } from "lit";
import { t } from "../../i18n/index.ts";
import type { MemoryEntry, MemoryGraph } from "../controllers/memory.ts";
import { icons } from "../icons.ts";

export type MemoryViewMode = "table" | "graph";

export interface MemoryProps {
  connected: boolean;
  loading: boolean;
  agentId: string | null;
  entries: MemoryEntry[];
  error: string | null;
  onRefresh: () => void;
  viewMode: MemoryViewMode;
  graph: MemoryGraph;
  graphLoading: boolean;
  graphError: string | null;
  onToggleView: (mode: MemoryViewMode) => void;
  renderGraph: () => unknown;
}

const MEMORY_GRID = "grid-template-columns: 1.2fr 2fr;";

function renderTable(props: MemoryProps) {
  if (props.entries.length === 0) {
    return html`<div class="muted" style="padding: 16px;">
      ${props.loading ? t("common.loading") : t("memoryView.empty")}
    </div>`;
  }
  return html`
    <div class="table">
      <div class="table-head" style=${MEMORY_GRID}>
        <span>${t("memoryView.colMemory")}</span>
        <span>${t("memoryView.colDetail")}</span>
      </div>
      ${props.entries.map(
        (e) => html`
          <div class="table-row" style=${MEMORY_GRID}>
            <span style="font-family: var(--mono); color: var(--text);">${e.name}</span>
            <span class="muted">${e.description || "—"}</span>
          </div>
        `,
      )}
    </div>
  `;
}

function renderToggle(props: MemoryProps) {
  const btn = (mode: MemoryViewMode, label: string) => html`
    <button
      class="btn ${props.viewMode === mode ? "active" : ""}"
      aria-pressed=${props.viewMode === mode}
      @click=${() => props.onToggleView(mode)}
    >
      ${label}
    </button>
  `;
  return html`<div class="row" style="gap: 4px;">
    ${btn("table", t("memoryView.viewTable"))}${btn("graph", t("memoryView.viewGraph"))}
  </div>`;
}

function renderBody(props: MemoryProps) {
  if (props.viewMode === "graph") {
    if (props.graphError) {
      return nothing;
    }
    if (props.graphLoading && props.graph.nodes.length === 0) {
      return html`<div class="muted" style="padding: 16px;">${t("common.loading")}</div>`;
    }
    return props.renderGraph();
  }
  return renderTable(props);
}

export function renderMemory(props: MemoryProps) {
  const loading = props.viewMode === "graph" ? props.graphLoading : props.loading;
  const error = props.viewMode === "graph" ? props.graphError : props.error;
  return html`
    <section class="card" style="border: none; background: transparent; padding: 0;">
      <div class="row" style="justify-content: space-between; align-items: flex-start;">
        <div>
          <div class="card-title">${t("tabs.memory")}</div>
          <div class="card-sub">
            ${t("subtitles.memory")}${props.entries.length
              ? html` · <span style="font-family: var(--mono);">${props.entries.length}</span>`
              : nothing}
          </div>
        </div>
        <div class="row" style="gap: 8px; align-items: center;">
          ${renderToggle(props)}
          <button class="btn" ?disabled=${loading} @click=${props.onRefresh}>
            ${icons.refresh} ${loading ? t("common.loading") : t("common.refresh")}
          </button>
        </div>
      </div>

      ${error
        ? html`<div class="callout danger" style="margin-top: 16px;">${error}</div>`
        : nothing}

      <div style="margin-top: 20px;">
        ${!props.agentId
          ? html`<div class="muted" style="padding: 16px;">${t("memoryView.noAgent")}</div>`
          : renderBody(props)}
      </div>
    </section>
  `;
}
