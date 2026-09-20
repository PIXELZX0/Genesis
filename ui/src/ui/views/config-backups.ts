/**
 * Config backup restore panel. The gateway keeps a rotation ring plus a
 * last-known-good copy of genesis.json; this lists them and restores one.
 */

import { html, nothing, type TemplateResult } from "lit";
import type { ConfigBackupEntry } from "../controllers/config-backups.ts";
import { formatRelativeTimestamp, formatSize } from "../format.ts";
import { icons } from "../icons.ts";
import { dialogChrome } from "./entity-dialogs.ts";

export type ConfigBackupsViewProps = {
  dir: string;
  entries: ConfigBackupEntry[];
  loading: boolean;
  error: string | null;
  restoreId: string | null;
  restoring: boolean;
  onBack?: () => void;
  onRefresh?: () => void;
  onRestoreRequest?: (id: string) => void;
  onRestoreCancel?: () => void;
  onRestoreConfirm?: () => void;
};

const LABELS: Record<string, string> = {
  bak: "Previous config",
  "last-good": "Last known good",
};

export function labelForBackup(id: string): string {
  const known = LABELS[id];
  if (known) {
    return known;
  }
  const ring = /^bak\.(\d+)$/.exec(id);
  return ring ? `${ring[1]} writes ago` : id;
}

function renderRow(props: ConfigBackupsViewProps, entry: ConfigBackupEntry): TemplateResult {
  return html`
    <div class="qs-row">
      <span class="qs-row__label">
        ${labelForBackup(entry.id)}
        <span class="muted">
          · ${formatRelativeTimestamp(entry.modifiedAt)} · ${formatSize(entry.bytes)}
        </span>
      </span>
      <span class="qs-row__value">
        <code class="qs-muted">${entry.id}</code>
        <button
          class="qs-link-btn"
          ?disabled=${props.restoring}
          @click=${() => props.onRestoreRequest?.(entry.id)}
        >
          Restore
        </button>
      </span>
    </div>
  `;
}

export function renderConfigBackupsView(props: ConfigBackupsViewProps) {
  return html`
    <div class="auth-profiles-view">
      <div class="qs-card">
        <div class="qs-card__header">
          <div class="qs-card__header-left">
            ${props.onBack
              ? html`<button class="qs-link-btn" @click=${props.onBack}>← Back</button>`
              : nothing}
            <span class="qs-card__icon">${icons.refresh}</span>
            <h3 class="qs-card__title">Config backups</h3>
          </div>
          <button class="qs-link-btn" @click=${props.onRefresh}>Refresh</button>
        </div>
        <div class="qs-card__body">
          ${props.error ? html`<div class="callout danger">${props.error}</div>` : nothing}
          ${props.entries.length === 0
            ? html`<div class="qs-empty muted">
                ${props.loading ? "Loading…" : "No backups yet"}
              </div>`
            : props.entries.map((entry) => renderRow(props, entry))}
          <div class="muted qs-card__note">
            Restoring writes the backup over the live config; the current config is rotated into the
            ring first. Files live in <code>${props.dir}</code>.
          </div>
        </div>
      </div>
      ${renderRestoreConfirm(props)}
    </div>
  `;
}

function renderRestoreConfirm(props: ConfigBackupsViewProps) {
  if (!props.restoreId) {
    return nothing;
  }
  return dialogChrome({
    title: `Restore ${labelForBackup(props.restoreId)}?`,
    sub: "The live config is replaced by this backup. Changes made since then are kept only in the backup ring.",
    body: html``,
    busy: props.restoring,
    error: null,
    submitLabel: "Restore",
    canSubmit: true,
    onCancel: () => props.onRestoreCancel?.(),
    onSubmit: () => props.onRestoreConfirm?.(),
  });
}
