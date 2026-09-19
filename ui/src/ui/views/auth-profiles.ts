/**
 * Auth profiles view — full CRUD panel for the per-provider auth profile
 * store. Lists every profile with name, priority, masked key, expiry, and
 * source (env / SecretRef / plaintext), with Add / Rename / Remove /
 * Set-Priority actions. Sits behind the Quick Settings "Manage" button
 * for a provider; the dashboard surface routes here.
 */

import { html, nothing, type TemplateResult } from "lit";
import { icons } from "../icons.ts";
import type { ModelAuthStatusResult } from "../types.ts";
import { dialogChrome, field } from "./entity-dialogs.ts";

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
  loading?: boolean;
  error?: string | null;
};

export type AuthProfileDialog = {
  kind: "add" | "rename" | "priority" | "remove";
  provider: string;
  profileId: string;
  mode: "api_key" | "token";
  value: string;
  displayName: string;
  priority: string;
  busy: boolean;
  error: string | null;
};

export function openAuthProfileDialog(
  kind: AuthProfileDialog["kind"],
  seed: Partial<Pick<AuthProfileDialog, "provider" | "profileId" | "displayName" | "priority">>,
): AuthProfileDialog {
  return {
    kind,
    provider: seed.provider ?? "",
    profileId: seed.profileId ?? "",
    mode: "api_key",
    value: "",
    displayName: seed.displayName ?? "",
    priority: seed.priority ?? "",
    busy: false,
    error: null,
  };
}

/** Status snapshot → view rows. The snapshot carries no key material or source. */
export function projectAuthStatusToProviders(
  status: ModelAuthStatusResult | null,
): AuthProfileProvider[] {
  return (status?.providers ?? []).map((provider) => ({
    provider: provider.provider,
    displayName: provider.displayName,
    profiles: provider.profiles.map((profile) => ({
      profileId: profile.profileId,
      provider: provider.provider,
      type: profile.type,
      displayName: profile.displayName,
      priority: profile.priority,
      expiryLabel: profile.expiry?.label,
      isSet: profile.status !== "missing",
      source: "unknown",
    })),
  }));
}

export type AuthProfileDialogCallbacks = {
  onChange: (patch: Partial<AuthProfileDialog>) => void;
  onCancel: () => void;
  onSubmit: () => void;
};

export function canSubmitAuthProfileDialog(dialog: AuthProfileDialog): boolean {
  switch (dialog.kind) {
    case "add":
      return Boolean(dialog.provider.trim() && dialog.profileId.trim() && dialog.value.trim());
    case "rename":
      return Boolean(dialog.displayName.trim());
    case "priority":
      return dialog.priority.trim() === "" || Number.isInteger(Number(dialog.priority));
    case "remove":
      return true;
  }
}

export function renderAuthProfileDialog(
  dialog: AuthProfileDialog | null,
  cb: AuthProfileDialogCallbacks,
): TemplateResult | typeof nothing {
  if (!dialog) {
    return nothing;
  }
  const chrome = {
    busy: dialog.busy,
    error: dialog.error,
    canSubmit: canSubmitAuthProfileDialog(dialog),
    onCancel: cb.onCancel,
    onSubmit: cb.onSubmit,
  };
  switch (dialog.kind) {
    case "add":
      return dialogChrome({
        ...chrome,
        title: "Add auth profile",
        sub: "Stored in the gateway auth profile store, not in genesis.json.",
        submitLabel: "Add",
        body: html`
          ${field("Provider", dialog.provider, (provider) => cb.onChange({ provider }), {
            placeholder: "anthropic",
          })}
          ${field("Profile id", dialog.profileId, (profileId) => cb.onChange({ profileId }), {
            placeholder: "anthropic:work",
          })}
          <label class="field full">
            <span>Type</span>
            <select
              .value=${dialog.mode}
              @change=${(e: Event) =>
                cb.onChange({
                  mode: (e.target as HTMLSelectElement).value as AuthProfileDialog["mode"],
                })}
            >
              <option value="api_key">API key</option>
              <option value="token">Token</option>
            </select>
          </label>
          ${field("Key", dialog.value, (value) => cb.onChange({ value }), { type: "password" })}
          ${field("Display name (optional)", dialog.displayName, (displayName) =>
            cb.onChange({ displayName }),
          )}
        `,
      });
    case "rename":
      return dialogChrome({
        ...chrome,
        title: "Rename profile",
        sub: dialog.profileId,
        submitLabel: "Save",
        body: field("Display name", dialog.displayName, (displayName) =>
          cb.onChange({ displayName }),
        ),
      });
    case "priority":
      return dialogChrome({
        ...chrome,
        title: "Set priority",
        sub: `${dialog.profileId} · higher is tried first; blank = round-robin`,
        submitLabel: "Save",
        body: field("Priority", dialog.priority, (priority) => cb.onChange({ priority }), {
          type: "number",
        }),
      });
    case "remove":
      return dialogChrome({
        ...chrome,
        title: "Remove profile?",
        sub: `${dialog.profileId} will be deleted from the auth profile store. This cannot be undone.`,
        submitLabel: "Remove",
        body: html``,
      });
  }
}

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
      return html``;
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
            <button class="qs-link-btn" @click=${() => props.onAdd?.("")}>+ Add profile</button>
          </div>
        `}
        <div class="qs-card__body">
          ${props.error ? html`<div class="callout danger">${props.error}</div>` : nothing}
          ${props.loading && props.providers.length === 0
            ? html`<div class="qs-empty muted">Loading…</div>`
            : nothing}
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
