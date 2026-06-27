import { html, nothing } from "lit";
import { t } from "../../i18n/index.ts";
import type { ContactEntry } from "../controllers/contacts.ts";
import { icons } from "../icons.ts";

export interface ContactsProps {
  connected: boolean;
  loading: boolean;
  agentId: string | null;
  entries: ContactEntry[];
  error: string | null;
  onRefresh: () => void;
}

const CONTACTS_GRID = "grid-template-columns: 1.6fr 1.6fr 0.5fr 0.6fr;";

function relTime(ms: number): string {
  if (!ms) {
    return "—";
  }
  const diff = Date.now() - ms;
  const day = 86_400_000;
  if (diff < day) {
    return "today";
  }
  const days = Math.floor(diff / day);
  if (days < 7) {
    return `${days}d`;
  }
  if (days < 30) {
    return `${Math.floor(days / 7)}w`;
  }
  return `${Math.floor(days / 30)}mo`;
}

function renderDetail(e: ContactEntry): string {
  const parts: string[] = [];
  if (e.traits && e.traits.length > 0) {
    parts.push(e.traits.join(", "));
  }
  if (e.education) {
    parts.push(e.education);
  }
  if (parts.length === 0 && e.notes) {
    parts.push(e.notes);
  }
  return parts.join(" · ");
}

function renderTable(props: ContactsProps) {
  if (props.entries.length === 0) {
    return html`<div class="muted" style="padding: 16px;">
      ${props.loading ? t("common.loading") : t("contactsView.empty")}
    </div>`;
  }
  return html`
    <div class="table">
      <div class="table-head" style=${CONTACTS_GRID}>
        <span>${t("contactsView.colName")}</span>
        <span>${t("contactsView.colMessengers")}</span>
        <span>${t("contactsView.colAge")}</span>
        <span>${t("contactsView.colUpdated")}</span>
      </div>
      ${props.entries.map((e) => {
        const detail = renderDetail(e);
        return html`
          <div class="table-row" style=${CONTACTS_GRID}>
            <span style="display: flex; flex-direction: column; gap: 2px;">
              <span style="color: var(--text);">${e.name}</span>
              ${detail
                ? html`<span class="muted" style="font-size: 12px;">${detail}</span>`
                : nothing}
            </span>
            <span style="display: flex; flex-wrap: wrap; gap: 4px; align-items: center;">
              ${e.messengerIds.length === 0
                ? html`<span class="muted">—</span>`
                : e.messengerIds.map(
                    (m) => html`<span
                      style="font-family: var(--mono); font-size: 11px; letter-spacing: 0.5px; color: var(--text-secondary, var(--muted)); border: 1px solid var(--border); border-radius: 6px; padding: 2px 6px;"
                      >${m.channel}</span
                    >`,
                  )}
            </span>
            <span class="muted">${e.age ?? "—"}</span>
            <span class="muted" style="font-family: var(--mono);">${relTime(e.updatedAt)}</span>
          </div>
        `;
      })}
    </div>
  `;
}

export function renderContacts(props: ContactsProps) {
  return html`
    <section class="card" style="border: none; background: transparent; padding: 0;">
      <div class="row" style="justify-content: space-between; align-items: flex-start;">
        <div>
          <div class="card-title">${t("tabs.contact")}</div>
          <div class="card-sub">
            ${t("subtitles.contact")}${props.entries.length
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
          ? html`<div class="muted" style="padding: 16px;">${t("contactsView.noAgent")}</div>`
          : renderTable(props)}
      </div>
    </section>
  `;
}
