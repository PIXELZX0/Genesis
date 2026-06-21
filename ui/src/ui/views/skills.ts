import { html, nothing } from "lit";
import { ref } from "lit/directives/ref.js";
import { t } from "../../i18n/index.ts";
import type {
  ClawHubSearchResult,
  ClawHubSkillDetail,
  SkillMessageMap,
} from "../controllers/skills.ts";
import { clampText } from "../format.ts";
import { icons } from "../icons.ts";
import { resolveSafeExternalUrl } from "../open-external-url.ts";
import { normalizeLowercaseStringOrEmpty } from "../string-coerce.ts";
import type { SkillStatusEntry, SkillStatusReport } from "../types.ts";
import {
  computeSkillMissing,
  computeSkillReasons,
  renderSkillStatusChips,
} from "./skills-shared.ts";

function safeExternalHref(raw?: string): string | null {
  if (!raw) {
    return null;
  }
  return resolveSafeExternalUrl(raw, window.location.href);
}

function showDialogWhenClosed(el?: Element) {
  if (!(el instanceof HTMLDialogElement) || el.open) {
    return;
  }
  queueMicrotask(() => {
    if (!el.isConnected || el.open) {
      return;
    }
    el.showModal();
  });
}

export type SkillsStatusFilter = "all" | "ready" | "needs-setup" | "disabled";

export type SkillsProps = {
  connected: boolean;
  loading: boolean;
  report: SkillStatusReport | null;
  error: string | null;
  filter: string;
  statusFilter: SkillsStatusFilter;
  edits: Record<string, string>;
  busyKey: string | null;
  messages: SkillMessageMap;
  detailKey: string | null;
  clawhubQuery: string;
  clawhubResults: ClawHubSearchResult[] | null;
  clawhubSearchLoading: boolean;
  clawhubSearchError: string | null;
  clawhubDetail: ClawHubSkillDetail | null;
  clawhubDetailSlug: string | null;
  clawhubDetailLoading: boolean;
  clawhubDetailError: string | null;
  clawhubInstallSlug: string | null;
  clawhubInstallMessage: { kind: "success" | "error"; text: string } | null;
  onFilterChange: (next: string) => void;
  onStatusFilterChange: (next: SkillsStatusFilter) => void;
  onRefresh: () => void;
  onToggle: (skillKey: string, enabled: boolean) => void;
  onEdit: (skillKey: string, value: string) => void;
  onSaveKey: (skillKey: string) => void;
  onInstall: (skillKey: string, name: string, installId: string) => void;
  onDetailOpen: (skillKey: string) => void;
  onDetailClose: () => void;
  onClawHubQueryChange: (query: string) => void;
  onClawHubDetailOpen: (slug: string) => void;
  onClawHubDetailClose: () => void;
  onClawHubInstall: (slug: string) => void;
};

const SKILLS_GRID = "grid-template-columns: 1fr 90px;";

function skillStatusClass(skill: SkillStatusEntry): string {
  if (skill.disabled) {
    return "muted";
  }
  return skill.eligible ? "ok" : "warn";
}

export function renderSkills(props: SkillsProps) {
  const skills = props.report?.skills ?? [];
  const enabledCount = skills.filter((s) => !s.disabled).length;

  const filter = normalizeLowercaseStringOrEmpty(props.filter);
  const filtered = filter
    ? skills.filter((skill) =>
        normalizeLowercaseStringOrEmpty(
          [skill.name, skill.description, skill.source].join(" "),
        ).includes(filter),
      )
    : skills;

  const detailSkill = props.detailKey
    ? (skills.find((s) => s.skillKey === props.detailKey) ?? null)
    : null;

  return html`
    <section class="card" style="border: none; background: transparent; padding: 0;">
      <div class="row" style="justify-content: space-between; align-items: flex-start; gap: 16px;">
        <div>
          <div class="view-title">Skills</div>
          <div class="view-sub">${skills.length} installed · ${enabledCount} enabled</div>
        </div>
        <div class="data-table-search" style="width: 220px; flex: none;">
          ${icons.search}
          <input
            type="search"
            .value=${props.filter}
            placeholder="Search skills"
            @input=${(e: Event) => props.onFilterChange((e.target as HTMLInputElement).value)}
          />
        </div>
      </div>

      ${props.error
        ? html`<div class="callout danger" style="margin-top: 16px;">${props.error}</div>`
        : nothing}
      ${filtered.length === 0
        ? html`
            <div class="muted" style="padding: 16px;">
              ${!props.connected && !props.report
                ? "Not connected to gateway."
                : props.loading
                  ? t("common.loading")
                  : "No skills found."}
            </div>
          `
        : html`
            <div class="table" style="margin-top: 20px;">
              <div class="table-head" style=${SKILLS_GRID}>
                <span>SKILL</span>
                <span>ENABLED</span>
              </div>
              ${filtered.map((skill) => renderSkillRow(skill, props))}
            </div>
          `}

      <details class="card" style="margin-top: 24px;">
        <summary
          style="cursor: pointer; font-weight: 600; display: flex; align-items: center; gap: 8px;"
        >
          <span class="btn__icon">${icons.plus}</span> Add skill from ClawHub
        </summary>
        <div style="margin-top: 16px;">
          <div style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap;">
            <label class="field" style="flex: 1; min-width: 180px;">
              <input
                .value=${props.clawhubQuery}
                @input=${(e: Event) =>
                  props.onClawHubQueryChange((e.target as HTMLInputElement).value)}
                placeholder="Search ClawHub skills…"
                autocomplete="off"
                name="clawhub-search"
              />
            </label>
            <button
              class="btn btn--sm"
              ?disabled=${!props.connected || props.clawhubSearchLoading}
              @click=${() => props.onClawHubQueryChange("")}
            >
              Browse
            </button>
            ${props.clawhubSearchLoading ? html`<span class="muted">Searching…</span>` : nothing}
          </div>
          ${props.clawhubSearchError
            ? html`<div class="callout danger" style="margin-top: 8px;">
                ${props.clawhubSearchError}
              </div>`
            : nothing}
          ${props.clawhubInstallMessage
            ? html`<div
                class="callout ${props.clawhubInstallMessage.kind === "error"
                  ? "danger"
                  : "success"}"
                style="margin-top: 8px;"
              >
                ${props.clawhubInstallMessage.text}
              </div>`
            : nothing}
          ${renderClawHubResults(props)}
        </div>
      </details>
    </section>

    ${detailSkill ? renderSkillDetail(detailSkill, props) : nothing}
    ${props.clawhubDetailSlug ? renderClawHubDetailDialog(props) : nothing}
  `;
}

function renderSkillRow(skill: SkillStatusEntry, props: SkillsProps) {
  const busy = props.busyKey === skill.skillKey;
  return html`
    <div
      class="table-row"
      style="cursor: pointer; ${SKILLS_GRID}"
      @click=${() => props.onDetailOpen(skill.skillKey)}
    >
      <div style="display: flex; flex-direction: column; gap: 2px; min-width: 0;">
        <span
          style="font-family: var(--mono); color: var(--text); display: flex; align-items: center; gap: 8px;"
        >
          ${skill.emoji ? html`<span>${skill.emoji}</span>` : nothing}${skill.name}
        </span>
        <span class="muted" style="font-size: 13px; overflow: hidden; text-overflow: ellipsis;">
          ${clampText(skill.description, 140)}
        </span>
      </div>
      <label class="skill-toggle-wrap" @click=${(e: Event) => e.stopPropagation()}>
        <input
          type="checkbox"
          class="skill-toggle"
          .checked=${!skill.disabled}
          ?disabled=${busy}
          @change=${(e: Event) => {
            e.stopPropagation();
            props.onToggle(skill.skillKey, skill.disabled);
          }}
        />
      </label>
    </div>
  `;
}

function renderClawHubResults(props: SkillsProps) {
  const results = props.clawhubResults;
  if (!results) {
    return html`<div class="muted" style="margin-top: 8px;">
      Search or browse ClawHub to install registry skills.
    </div>`;
  }
  if (results.length === 0) {
    return html`<div class="muted" style="margin-top: 8px;">No skills found on ClawHub.</div>`;
  }
  return html`
    <div class="list" style="margin-top: 8px;">
      ${results.map(
        (r) => html`
          <div
            class="list-item list-item-clickable"
            @click=${() => props.onClawHubDetailOpen(r.slug)}
          >
            <div class="list-main">
              <div class="list-title">${r.displayName}</div>
              <div class="list-sub">${r.summary ? clampText(r.summary, 120) : r.slug}</div>
            </div>
            <div class="list-meta" style="display: flex; align-items: center; gap: 8px;">
              ${r.version
                ? html`<span class="muted" style="font-size: 12px;">v${r.version}</span>`
                : nothing}
              <button
                class="btn btn--sm"
                ?disabled=${props.clawhubInstallSlug !== null}
                @click=${(e: Event) => {
                  e.stopPropagation();
                  props.onClawHubInstall(r.slug);
                }}
              >
                ${props.clawhubInstallSlug === r.slug ? "Installing\u2026" : "Install"}
              </button>
            </div>
          </div>
        `,
      )}
    </div>
  `;
}

function renderClawHubDetailDialog(props: SkillsProps) {
  const detail = props.clawhubDetail;

  return html`
    <dialog
      class="md-preview-dialog"
      ${ref(showDialogWhenClosed)}
      @click=${(e: Event) => {
        const dialog = e.currentTarget as HTMLDialogElement;
        if (e.target === dialog) {
          dialog.close();
        }
      }}
      @close=${props.onClawHubDetailClose}
    >
      <div class="md-preview-dialog__panel">
        <div class="md-preview-dialog__header">
          <div class="md-preview-dialog__title">
            ${detail?.skill?.displayName ?? props.clawhubDetailSlug}
          </div>
          <button
            class="btn btn--sm"
            @click=${(e: Event) => {
              (e.currentTarget as HTMLElement).closest("dialog")?.close();
            }}
          >
            Close
          </button>
        </div>
        <div class="md-preview-dialog__body" style="display: grid; gap: 16px;">
          ${props.clawhubDetailLoading
            ? html`<div class="muted">${t("common.loading")}</div>`
            : props.clawhubDetailError
              ? html`<div class="callout danger">${props.clawhubDetailError}</div>`
              : detail?.skill
                ? html`
                    <div style="font-size: 14px; line-height: 1.5;">
                      ${detail.skill.summary ?? ""}
                    </div>
                    ${detail.owner?.displayName
                      ? html`<div class="muted" style="font-size: 13px;">
                          By
                          ${detail.owner.displayName}${detail.owner.handle
                            ? html` (@${detail.owner.handle})`
                            : nothing}
                        </div>`
                      : nothing}
                    ${detail.latestVersion
                      ? html`<div class="muted" style="font-size: 13px;">
                          Latest: v${detail.latestVersion.version}
                        </div>`
                      : nothing}
                    ${detail.latestVersion?.changelog
                      ? html`<div
                          style="font-size: 13px; border-top: 1px solid var(--border); padding-top: 12px; white-space: pre-wrap;"
                        >
                          ${detail.latestVersion.changelog}
                        </div>`
                      : nothing}
                    ${detail.metadata?.os
                      ? html`<div class="muted" style="font-size: 12px;">
                          Platforms: ${detail.metadata.os.join(", ")}
                        </div>`
                      : nothing}
                    <button
                      class="btn primary"
                      ?disabled=${props.clawhubInstallSlug !== null}
                      @click=${() => {
                        if (props.clawhubDetailSlug) {
                          props.onClawHubInstall(props.clawhubDetailSlug);
                        }
                      }}
                    >
                      ${props.clawhubInstallSlug === props.clawhubDetailSlug
                        ? "Installing\u2026"
                        : `Install ${detail.skill.displayName}`}
                    </button>
                  `
                : html`<div class="muted">Skill not found.</div>`}
        </div>
      </div>
    </dialog>
  `;
}

function renderSkillDetail(skill: SkillStatusEntry, props: SkillsProps) {
  const busy = props.busyKey === skill.skillKey;
  const apiKey = props.edits[skill.skillKey] ?? "";
  const message = props.messages[skill.skillKey] ?? null;
  const canInstall = skill.install.length > 0 && skill.missing.bins.length > 0;
  const showBundledBadge = Boolean(skill.bundled && skill.source !== "genesis-bundled");
  const missing = computeSkillMissing(skill);
  const reasons = computeSkillReasons(skill);

  return html`
    <dialog
      class="md-preview-dialog"
      ${ref(showDialogWhenClosed)}
      @click=${(e: Event) => {
        const dialog = e.currentTarget as HTMLDialogElement;
        if (e.target === dialog) {
          dialog.close();
        }
      }}
      @close=${props.onDetailClose}
    >
      <div class="md-preview-dialog__panel">
        <div class="md-preview-dialog__header">
          <div
            class="md-preview-dialog__title"
            style="display: flex; align-items: center; gap: 8px;"
          >
            <span class="statusDot ${skillStatusClass(skill)}"></span>
            ${skill.emoji ? html`<span style="font-size: 18px;">${skill.emoji}</span>` : nothing}
            <span>${skill.name}</span>
          </div>
          <button
            class="btn btn--sm"
            @click=${(e: Event) => {
              (e.currentTarget as HTMLElement).closest("dialog")?.close();
            }}
          >
            Close
          </button>
        </div>
        <div class="md-preview-dialog__body" style="display: grid; gap: 16px;">
          <div>
            <div style="font-size: 14px; line-height: 1.5; color: var(--text);">
              ${skill.description}
            </div>
            ${renderSkillStatusChips({ skill, showBundledBadge })}
          </div>

          ${missing.length > 0
            ? html`
                <div
                  class="callout"
                  style="border-color: var(--warn-subtle); background: var(--warn-subtle); color: var(--warn);"
                >
                  <div style="font-weight: 600; margin-bottom: 4px;">Missing requirements</div>
                  <div>${missing.join(", ")}</div>
                </div>
              `
            : nothing}
          ${reasons.length > 0
            ? html`
                <div class="muted" style="font-size: 13px;">Reason: ${reasons.join(", ")}</div>
              `
            : nothing}

          <div style="display: flex; align-items: center; gap: 12px;">
            <label class="skill-toggle-wrap">
              <input
                type="checkbox"
                class="skill-toggle"
                .checked=${!skill.disabled}
                ?disabled=${busy}
                @change=${() => props.onToggle(skill.skillKey, skill.disabled)}
              />
            </label>
            <span style="font-size: 13px; font-weight: 500;">
              ${skill.disabled ? "Disabled" : "Enabled"}
            </span>
            ${canInstall
              ? html`<button
                  class="btn"
                  ?disabled=${busy}
                  @click=${() => props.onInstall(skill.skillKey, skill.name, skill.install[0].id)}
                >
                  ${busy ? "Installing\u2026" : skill.install[0].label}
                </button>`
              : nothing}
          </div>

          ${message
            ? html`<div class="callout ${message.kind === "error" ? "danger" : "success"}">
                ${message.message}
              </div>`
            : nothing}
          ${skill.primaryEnv
            ? html`
                <div style="display: grid; gap: 8px;">
                  <div class="field">
                    <span
                      >API key
                      <span class="muted" style="font-weight: normal; font-size: 0.88em;"
                        >(${skill.primaryEnv})</span
                      ></span
                    >
                    <input
                      type="password"
                      .value=${apiKey}
                      @input=${(e: Event) =>
                        props.onEdit(skill.skillKey, (e.target as HTMLInputElement).value)}
                    />
                  </div>
                  ${(() => {
                    const href = safeExternalHref(skill.homepage);
                    return href
                      ? html`<div class="muted" style="font-size: 13px;">
                          Get your key:
                          <a href="${href}" target="_blank" rel="noopener noreferrer"
                            >${skill.homepage}</a
                          >
                        </div>`
                      : nothing;
                  })()}
                  <button
                    class="btn primary"
                    ?disabled=${busy}
                    @click=${() => props.onSaveKey(skill.skillKey)}
                  >
                    Save key
                  </button>
                </div>
              `
            : nothing}

          <div
            style="border-top: 1px solid var(--border); padding-top: 12px; display: grid; gap: 6px; font-size: 12px; color: var(--muted);"
          >
            <div><span style="font-weight: 600;">Source:</span> ${skill.source}</div>
            <div style="font-family: var(--mono); word-break: break-all;">${skill.filePath}</div>
            ${(() => {
              const safeHref = safeExternalHref(skill.homepage);
              return safeHref
                ? html`<div>
                    <a href="${safeHref}" target="_blank" rel="noopener noreferrer"
                      >${skill.homepage}</a
                    >
                  </div>`
                : nothing;
            })()}
          </div>
        </div>
      </div>
    </dialog>
  `;
}
