import { html, nothing } from "lit";
import { t } from "../../i18n/index.ts";
import type { MemoryEntry } from "../controllers/memory.ts";
import { icons } from "../icons.ts";

export interface MemoryProps {
  connected: boolean;
  loading: boolean;
  agentId: string | null;
  entries: MemoryEntry[];
  error: string | null;
  onRefresh: () => void;
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

export function renderMemory(props: MemoryProps) {
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
        <button class="btn" ?disabled=${props.loading} @click=${props.onRefresh}>
          ${icons.refresh} ${props.loading ? t("common.loading") : t("common.refresh")}
        </button>
      </div>

      ${props.error
        ? html`<div class="callout danger" style="margin-top: 16px;">${props.error}</div>`
        : nothing}

      <div style="margin-top: 20px;">
        ${!props.agentId
          ? html`<div class="muted" style="padding: 16px;">${t("memoryView.noAgent")}</div>`
          : renderTable(props)}
      </div>
    </section>
  `;
}
