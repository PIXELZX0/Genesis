/**
 * Auth profiles view — full CRUD panel for the per-provider auth profile
 * store. Lists every profile with name, priority, masked key, expiry, and
 * source (env / SecretRef / plaintext), with Add / Rename / Remove /
 * Set-Priority actions. Sits behind the Quick Settings "Manage" button
 * for a provider; the dashboard surface routes here.
 */

import { html, nothing, type TemplateResult } from "lit";
import { icons } from "../icons.ts";

export type AuthProfileSource = "env" | "secret_ref" | "plaintext" | "external" | "unknown";

export type AuthProfileRow = {
  profileId: string;
  provider: string;
  type: "oauth" | "token" | "api_key";
  displayName?: string;
  priority?: number;
  masked?: string;
  expiryLabel?: string;
  isSet: boolean;
  source: AuthProfileSource;
};

export type AuthProfileProvider = {
  provider: string;
  displayName: string;
  profiles: AuthProfileRow[];
};

export type AuthProfilesViewProps = {
  providers: AuthProfileProvider[];
  onAdd?: (provider: string) => void;
  onRename?: (profileId: string) => void;
  onRemove?: (profileId: string) => void;
  onSetPriority?: (profileId: string) => void;
  onBack?: () => void;
};

function renderPriorityPill(priority: number | undefined): TemplateResult {
  if (typeof priority !== "number") {
    return html`<span class="qs-pill qs-pill--muted">round-robin</span>`;
  }
  return html`<span class="qs-pill qs-pill--accent">priority ${priority}</span>`;
}

function renderSourcePill(source: AuthProfileSource): TemplateResult {
  switch (source) {
    case "env":
      return html`<span class="qs-pill qs-pill--ok">env</span>`;
    case "secret_ref":
      return html`<span class="qs-pill qs-pill--ok">SecretRef</span>`;
    case "plaintext":
      return html`<span class="qs-pill qs-pill--warn">plaintext</span>`;
    case "external":
      return html`<span class="qs-pill">external</span>`;
    default:
      return html`<span class="qs-pill qs-pill--muted">unknown</span>`;
  }
}

function renderRowActions(props: AuthProfilesViewProps, row: AuthProfileRow): TemplateResult {
  return html`
    <div class="qs-row__actions">
      <button class="qs-link-btn" @click=${() => props.onRename?.(row.profileId)}>Rename</button>
      <button class="qs-link-btn" @click=${() => props.onSetPriority?.(row.profileId)}>
        Set priority
      </button>
      <button
        class="qs-link-btn qs-link-btn--danger"
        @click=${() => props.onRemove?.(row.profileId)}
      >
        Remove
      </button>
    </div>
  `;
}

function renderProfileRow(props: AuthProfilesViewProps, row: AuthProfileRow): TemplateResult {
  const label = row.displayName ?? row.profileId;
  return html`
    <div class="qs-profile-row" data-profile-id=${row.profileId}>
      <div class="qs-profile-row__main">
        <div class="qs-profile-row__title">
          <code>${label}</code>
          ${renderPriorityPill(row.priority)} ${renderSourcePill(row.source)}
        </div>
        <div class="qs-profile-row__meta muted">
          <span>${row.type}</span>
          ${row.expiryLabel ? html`<span>· expires in ${row.expiryLabel}</span>` : nothing}
          <span>· ${row.profileId}</span>
        </div>
      </div>
      <div class="qs-profile-row__value">
        ${row.isSet
          ? html`<code class="qs-masked">${row.masked ?? "••••••••"}</code>`
          : html`<span class="muted">(not set)</span>`}
      </div>
      ${renderRowActions(props, row)}
    </div>
  `;
}

export function renderAuthProfilesView(props: AuthProfilesViewProps): TemplateResult {
  return html`
    <div class="auth-profiles-view">
      <div class="qs-card">
        ${html`
          <div class="qs-card__header">
            <div class="qs-card__header-left">
              ${props.onBack
                ? html`<button class="qs-link-btn" @click=${props.onBack}>← Back</button>`
                : nothing}
              <span class="qs-card__icon">${icons.plug}</span>
              <h3 class="qs-card__title">Auth profiles</h3>
            </div>
          </div>
        `}
        <div class="qs-card__body">
          ${props.providers.length === 0
            ? html`<div class="qs-empty muted">No auth profiles configured</div>`
            : props.providers.map(
                (prov) => html`
                  <div class="qs-provider-section">
                    <div class="qs-provider-section__header">
                      <h4>${prov.displayName}</h4>
                      <button class="qs-link-btn" @click=${() => props.onAdd?.(prov.provider)}>
                        + Add profile
                      </button>
                    </div>
                    ${prov.profiles.length === 0
                      ? html`<div class="qs-empty muted">No profiles for ${prov.displayName}</div>`
                      : prov.profiles.map((row) => renderProfileRow(props, row))}
                  </div>
                `,
              )}
        </div>
      </div>
    </div>
  `;
}
