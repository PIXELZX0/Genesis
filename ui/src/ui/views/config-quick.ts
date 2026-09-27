/**
 * Quick Settings view — opinionated card layout for the most common settings.
 * Replaces the raw schema-driven form as the default settings experience.
 *
 * Each card answers a "what do I want to do?" question with status + actions.
 */

import { html, nothing, type TemplateResult } from "lit";
import { SUPPORTED_LOCALES, t, type Locale } from "../../i18n/index.ts";
import { icons } from "../icons.ts";
import type { BorderRadiusStop } from "../storage.ts";
import type { ThemeTransitionContext } from "../theme-transition.ts";
import type { ThemeMode } from "../theme.ts";
import { listThinkingLevelLabels } from "../thinking.ts";
import {
  hasLocalUserIdentity,
  normalizeLocalUserIdentity,
  resolveLocalUserAvatarText,
  resolveLocalUserAvatarUrl,
  resolveLocalUserName,
} from "../user-identity.ts";
import { CONFIG_PRESETS, detectActivePreset, type ConfigPresetId } from "./config-presets.ts";
import { dialogChrome } from "./entity-dialogs.ts";

// ── Types ──

export type QuickSettingsChannel = {
  id: string;
  label: string;
  connected: boolean;
  detail?: string;
};

export type QuickSettingsApiKey = {
  provider: string;
  label: string;
  masked?: string;
  isSet: boolean;
  /**
   * Optional list of additional profiles for this provider. When present, the
   * renderer surfaces one row per profile (instead of collapsing the provider
   * into a single "Add/Change" action). `displayName` and `priority` are
   * the routing metadata the user can edit from the auth-profiles panel.
   */
  profiles?: Array<{
    profileId: string;
    displayName?: string;
    priority?: number;
    masked?: string;
    expiryLabel?: string;
    isSet: boolean;
  }>;
};

export type QuickSettingsAutomation = {
  cronJobCount: number;
  skillCount: number;
  mcpServerCount: number;
};

export type QuickSettingsSecurity = {
  gatewayAuth: string;
  /** tools.exec.security, or "default" when unset. */
  execPolicy: string;
  /** tools.exec.ask, or "default" when unset. */
  execAsk: string;
  deviceAuth: boolean;
};

const EXEC_POLICIES = ["deny", "allowlist", "full"] as const;
const EXEC_ASK_MODES = ["off", "on-miss", "always"] as const;

export type QuickSettingsScope = "session" | "default";

export type QuickSettingsProps = {
  // Model & Thinking. `scope` picks whether thinking/fast edits patch the
  // active session or the config defaults for new sessions.
  scope: QuickSettingsScope;
  onScopeChange?: (scope: QuickSettingsScope) => void;
  /** False when there is no agents.list entry to hold fastModeDefault. */
  fastModeDefaultAvailable: boolean;
  currentModel: string;
  thinkingLevel: string;
  fastMode: boolean;
  onModelChange?: () => void;
  onThinkingChange?: (level: string) => void;
  onFastModeToggle?: () => void;

  // Channels
  channels: QuickSettingsChannel[];
  onChannelConfigure?: (channelId: string) => void;

  // API Keys
  apiKeys: QuickSettingsApiKey[];
  onApiKeyChange?: (provider: string) => void;

  // Automations
  automation: QuickSettingsAutomation;
  onManageCron?: () => void;
  onBrowseSkills?: () => void;
  onConfigureMcp?: () => void;

  // Security
  security: QuickSettingsSecurity;
  onSecurityConfigure?: () => void;
  onExecPolicyChange?: (policy: (typeof EXEC_POLICIES)[number]) => void;
  onExecAskChange?: (ask: (typeof EXEC_ASK_MODES)[number]) => void;

  // Appearance
  themeMode: ThemeMode;
  borderRadius: number;
  setThemeMode: (mode: ThemeMode, context?: ThemeTransitionContext) => void;
  setBorderRadius: (value: number) => void;
  userName?: string | null;
  userAvatar?: string | null;
  onUserNameChange?: (next: string) => void;
  onUserAvatarChange?: (next: string | null) => void;

  // Language & chat display (browser-local)
  locale: Locale;
  onLocaleChange?: (locale: Locale) => void;
  chatShowThinking: boolean;
  chatShowToolCalls: boolean;
  onChatDisplayChange?: (patch: {
    chatShowThinking?: boolean;
    chatShowToolCalls?: boolean;
  }) => void;

  // Presets
  configObject?: Record<string, unknown>;
  onApplyPreset?: (presetId: ConfigPresetId) => void;

  // Navigation
  onAdvancedSettings?: () => void;
  onOpenBackups?: () => void;

  // Connection
  connected: boolean;
  gatewayUrl: string;
  assistantName: string;
  version: string;
};

const BORDER_RADIUS_STOPS: Array<{ value: BorderRadiusStop; labelKey: string }> = [
  { value: 0, labelKey: "quickSettings.roundness.none" },
  { value: 25, labelKey: "quickSettings.roundness.slight" },
  { value: 50, labelKey: "quickSettings.roundness.soft" },
  { value: 75, labelKey: "quickSettings.roundness.round" },
  { value: 100, labelKey: "quickSettings.roundness.full" },
];

// Keep raw uploads comfortably below the 2 MB persisted data URL limit after
// base64 expansion and a small MIME/header prefix are added.
const MAX_LOCAL_USER_AVATAR_FILE_BYTES = 1_500_000;

function renderDefaultUserAvatar() {
  return html`
    <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
      <circle cx="12" cy="8" r="4" />
      <path d="M20 21a8 8 0 1 0-16 0" />
    </svg>
  `;
}

function renderLocalUserAvatarPreview(
  name: string | null | undefined,
  avatar: string | null | undefined,
) {
  const identity = normalizeLocalUserIdentity({ name, avatar });
  const label = resolveLocalUserName(identity);
  const avatarUrl = resolveLocalUserAvatarUrl(identity);
  const avatarText = resolveLocalUserAvatarText(identity);
  if (avatarUrl) {
    return html`<img class="qs-user-avatar" src=${avatarUrl} alt=${label} />`;
  }
  if (avatarText) {
    return html`<div class="qs-user-avatar qs-user-avatar--text" aria-label=${label}>
      ${avatarText}
    </div>`;
  }
  return html`
    <div class="qs-user-avatar qs-user-avatar--default" aria-label=${label}>
      ${renderDefaultUserAvatar()}
    </div>
  `;
}

function handleLocalUserAvatarFileSelect(e: Event, props: QuickSettingsProps) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  const onUserAvatarChange = props.onUserAvatarChange;
  if (!file || !onUserAvatarChange) {
    input.value = "";
    return;
  }
  if (!file.type.startsWith("image/")) {
    input.value = "";
    return;
  }
  if (file.size > MAX_LOCAL_USER_AVATAR_FILE_BYTES) {
    input.value = "";
    return;
  }
  const reader = new FileReader();
  reader.addEventListener("load", () => {
    onUserAvatarChange(typeof reader.result === "string" ? reader.result : null);
  });
  reader.readAsDataURL(file);
  input.value = "";
}

// ── Card renderers ──

function renderCardHeader(icon: TemplateResult, title: string, action?: TemplateResult) {
  return html`
    <div class="qs-card__header">
      <div class="qs-card__header-left">
        <span class="qs-card__icon">${icon}</span>
        <h3 class="qs-card__title">${title}</h3>
      </div>
      ${action ? action : nothing}
    </div>
  `;
}

function resolveThinkingLevels(current: string): readonly string[] {
  const levels = listThinkingLevelLabels();
  // Keep configured values outside the base list (xhigh, adaptive, max) selectable.
  return current && !levels.includes(current) ? [...levels, current] : levels;
}

function renderModelCard(props: QuickSettingsProps) {
  return html`
    <div class="qs-card">
      ${renderCardHeader(icons.brain, t("quickSettings.model.title"))}
      <div class="qs-card__body">
        <div class="qs-row">
          <span class="qs-row__label">${t("quickSettings.model.appliesTo")}</span>
          <div class="qs-segmented" role="group" aria-label=${t("quickSettings.model.scope")}>
            ${(
              [
                ["session", t("quickSettings.model.thisSession")],
                ["default", t("quickSettings.model.newSessions")],
              ] as const
            ).map(
              ([scope, label]) => html`
                <button
                  class="qs-segmented__btn ${scope === props.scope
                    ? "qs-segmented__btn--active"
                    : ""}"
                  aria-pressed=${scope === props.scope}
                  @click=${() => props.onScopeChange?.(scope)}
                >
                  ${label}
                </button>
              `,
            )}
          </div>
        </div>
        <div class="qs-row">
          <span class="qs-row__label">${t("quickSettings.model.model")}</span>
          <button class="qs-row__value qs-row__value--action" @click=${props.onModelChange}>
            <code>${props.currentModel || "default"}</code>
            <span class="qs-row__chevron">${icons.chevronRight}</span>
          </button>
        </div>
        <div class="qs-row">
          <span class="qs-row__label">${t("quickSettings.model.thinking")}</span>
          <div class="qs-segmented">
            ${resolveThinkingLevels(props.thinkingLevel).map(
              (level) => html`
                <button
                  class="qs-segmented__btn ${level === props.thinkingLevel
                    ? "qs-segmented__btn--active"
                    : ""}"
                  @click=${() => props.onThinkingChange?.(level)}
                >
                  ${level.charAt(0).toUpperCase() + level.slice(1)}
                </button>
              `,
            )}
          </div>
        </div>
        <div class="qs-row">
          <span class="qs-row__label">${t("quickSettings.model.fastMode")}</span>
          <label class="qs-toggle">
            <input
              type="checkbox"
              .checked=${props.fastMode}
              ?disabled=${props.scope === "default" && !props.fastModeDefaultAvailable}
              @change=${props.onFastModeToggle}
            />
            <span class="qs-toggle__track"></span>
            <span class="qs-toggle__hint muted"
              >${props.scope === "default" && !props.fastModeDefaultAvailable
                ? t("quickSettings.model.fastModePerAgent")
                : props.fastMode
                  ? t("quickSettings.model.fastModeOn")
                  : t("quickSettings.model.fastModeOff")}</span
            >
          </label>
        </div>
      </div>
    </div>
  `;
}

function renderChannelsCard(props: QuickSettingsProps) {
  const connectedCount = props.channels.filter((c) => c.connected).length;
  const badge =
    connectedCount > 0
      ? html`<span class="qs-badge qs-badge--ok">${connectedCount} connected</span>`
      : undefined;

  return html`
    <div class="qs-card">
      ${renderCardHeader(icons.send, t("quickSettings.channels.title"), badge)}
      <div class="qs-card__body">
        ${props.channels.length === 0
          ? html`<div class="qs-empty muted">${t("quickSettings.channels.empty")}</div>`
          : props.channels.map(
              (ch) => html`
                <div class="qs-row">
                  <span class="qs-row__label">
                    <span class="qs-status-dot ${ch.connected ? "qs-status-dot--ok" : ""}"></span>
                    ${ch.label}
                  </span>
                  <span class="qs-row__value">
                    ${ch.connected
                      ? html`<span class="muted">${ch.detail ?? t("common.connected")}</span>`
                      : html`<button
                          class="qs-link-btn"
                          @click=${() => props.onChannelConfigure?.(ch.id)}
                        >
                          Connect →
                        </button>`}
                  </span>
                </div>
              `,
            )}
      </div>
    </div>
  `;
}

function renderApiKeysCard(props: QuickSettingsProps) {
  const totalProfiles = props.apiKeys.reduce(
    (acc, key) =>
      acc + (key.profiles && key.profiles.length > 0 ? key.profiles.length : key.isSet ? 1 : 0),
    0,
  );
  const badge =
    totalProfiles > 1 ? html`<span class="qs-badge">${totalProfiles} profiles</span>` : undefined;
  return html`
    <div class="qs-card">
      ${renderCardHeader(icons.plug, t("quickSettings.apiKeys.title"), badge)}
      <div class="qs-card__body">
        ${props.apiKeys.length === 0
          ? html`<div class="qs-empty muted">${t("quickSettings.apiKeys.empty")}</div>`
          : props.apiKeys.map((key) => {
              // Multi-profile providers render one row per profile; the
              // single-credential shape is preserved for backwards compat
              // (callers that haven't migrated to the new shape still get a
              // working "Add / Change" affordance).
              if (key.profiles && key.profiles.length > 0) {
                return html`
                  <div class="qs-row qs-row--stack">
                    <span class="qs-row__label">${key.label}</span>
                    <div class="qs-profiles">
                      ${key.profiles.map(
                        (profile) => html`
                          <div class="qs-profile-row">
                            <code class="qs-muted">
                              ${profile.displayName ?? profile.profileId}
                            </code>
                            <span class="qs-profile-priority">
                              ${typeof profile.priority === "number"
                                ? `priority ${profile.priority}`
                                : "round-robin"}
                            </span>
                            <code class="qs-masked">
                              ${profile.isSet ? (profile.masked ?? "••••••••") : "(not set)"}
                            </code>
                            <button
                              class="qs-link-btn"
                              @click=${() => props.onApiKeyChange?.(key.provider)}
                            >
                              Manage
                            </button>
                          </div>
                        `,
                      )}
                    </div>
                  </div>
                `;
              }
              return html`
                <div class="qs-row">
                  <span class="qs-row__label">${key.label}</span>
                  <span class="qs-row__value">
                    ${key.isSet
                      ? html`
                          <code class="qs-masked">${key.masked ?? "••••••••"}</code>
                          <button
                            class="qs-link-btn"
                            @click=${() => props.onApiKeyChange?.(key.provider)}
                          >
                            Change
                          </button>
                        `
                      : html`<button
                          class="qs-link-btn"
                          @click=${() => props.onApiKeyChange?.(key.provider)}
                        >
                          Add →
                        </button>`}
                  </span>
                </div>
              `;
            })}
      </div>
    </div>
  `;
}

function renderAutomationsCard(props: QuickSettingsProps) {
  const { cronJobCount, skillCount, mcpServerCount } = props.automation;

  return html`
    <div class="qs-card">
      ${renderCardHeader(icons.zap, t("quickSettings.automations.title"))}
      <div class="qs-card__body">
        <div class="qs-row">
          <span class="qs-row__label">
            ${t("quickSettings.automations.scheduledTasks", { count: String(cronJobCount) })}
          </span>
          <button class="qs-link-btn" @click=${props.onManageCron}>
            ${t("quickSettings.actions.manage")}
          </button>
        </div>
        <div class="qs-row">
          <span class="qs-row__label">
            ${t("quickSettings.automations.skillsInstalled", { count: String(skillCount) })}
          </span>
          <button class="qs-link-btn" @click=${props.onBrowseSkills}>
            ${t("quickSettings.actions.browse")}
          </button>
        </div>
        <div class="qs-row">
          <span class="qs-row__label">
            ${t("quickSettings.automations.mcpServers", { count: String(mcpServerCount) })}
          </span>
          <button class="qs-link-btn" @click=${props.onConfigureMcp}>
            ${t("quickSettings.actions.configure")}
          </button>
        </div>
      </div>
    </div>
  `;
}

function renderSegmented<T extends string>(
  label: string,
  options: readonly T[],
  active: string,
  onSelect: ((value: T) => void) | undefined,
) {
  return html`
    <div class="qs-segmented" role="group" aria-label=${label}>
      ${options.map(
        (option) => html`
          <button
            class="qs-segmented__btn qs-segmented__btn--compact ${option === active
              ? "qs-segmented__btn--active"
              : ""}"
            aria-pressed=${option === active}
            @click=${() => {
              if (option !== active) {
                onSelect?.(option);
              }
            }}
          >
            ${option}
          </button>
        `,
      )}
    </div>
  `;
}

function renderSecurityCard(props: QuickSettingsProps) {
  const { gatewayAuth, execPolicy, execAsk, deviceAuth } = props.security;

  return html`
    <div class="qs-card">
      ${renderCardHeader(
        icons.eye,
        t("quickSettings.security.title"),
        html`<button class="qs-link-btn" @click=${props.onSecurityConfigure}>
          ${t("quickSettings.actions.configure")}
        </button>`,
      )}
      <div class="qs-card__body">
        <div class="qs-row">
          <span class="qs-row__label">${t("quickSettings.security.gatewayAuth")}</span>
          <span class="qs-row__value">
            <span
              class="qs-badge ${gatewayAuth === "none"
                ? "qs-badge--warn"
                : gatewayAuth === "unknown"
                  ? ""
                  : "qs-badge--ok"}"
              >${gatewayAuth}</span
            >
          </span>
        </div>
        <div class="qs-row">
          <span class="qs-row__label">${t("quickSettings.security.execPolicy")}</span>
          ${renderSegmented(
            t("quickSettings.security.execPolicy"),
            EXEC_POLICIES,
            execPolicy,
            props.onExecPolicyChange,
          )}
        </div>
        <div class="qs-row">
          <span class="qs-row__label">${t("quickSettings.security.execApproval")}</span>
          ${renderSegmented(
            t("quickSettings.security.execApproval"),
            EXEC_ASK_MODES,
            execAsk,
            props.onExecAskChange,
          )}
        </div>
        ${execPolicy === "default" || execAsk === "default"
          ? html`<div class="muted qs-card__note">
              Unset values fall back to exec-approvals defaults, then full on the gateway host (deny
              in the sandbox) with approval off.
            </div>`
          : nothing}
        <div class="qs-row">
          <span class="qs-row__label">${t("quickSettings.security.deviceAuth")}</span>
          <span class="qs-row__value">
            <span class="qs-badge ${deviceAuth ? "qs-badge--ok" : "qs-badge--warn"}"
              >${deviceAuth ? t("common.enabled") : t("common.disabled")}</span
            >
          </span>
        </div>
      </div>
    </div>
  `;
}

function renderAppearanceCard(props: QuickSettingsProps) {
  return html`
    <div class="qs-card">
      ${renderCardHeader(icons.spark, t("quickSettings.appearance.title"))}
      <div class="qs-card__body">
        <div class="qs-row">
          <span class="qs-row__label">${t("common.mode")}</span>
          <div class="qs-segmented">
            ${(["light", "dark", "system"] as ThemeMode[]).map(
              (mode) => html`
                <button
                  class="qs-segmented__btn ${mode === props.themeMode
                    ? "qs-segmented__btn--active"
                    : ""}"
                  @click=${(e: Event) => {
                    if (mode !== props.themeMode) {
                      props.setThemeMode(mode, {
                        element: (e.currentTarget as HTMLElement) ?? undefined,
                      });
                    }
                  }}
                >
                  ${mode.charAt(0).toUpperCase() + mode.slice(1)}
                </button>
              `,
            )}
          </div>
        </div>
        <div class="qs-row">
          <span class="qs-row__label">${t("quickSettings.appearance.roundness")}</span>
          <div class="qs-segmented">
            ${BORDER_RADIUS_STOPS.map(
              (stop) => html`
                <button
                  class="qs-segmented__btn qs-segmented__btn--compact ${stop.value ===
                  props.borderRadius
                    ? "qs-segmented__btn--active"
                    : ""}"
                  @click=${() => props.setBorderRadius(stop.value)}
                >
                  ${t(stop.labelKey)}
                </button>
              `,
            )}
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderPersonalCard(props: QuickSettingsProps) {
  const identity = normalizeLocalUserIdentity({
    name: props.userName ?? null,
    avatar: props.userAvatar ?? null,
  });
  const avatarText = resolveLocalUserAvatarText(identity) ?? "";
  const label = resolveLocalUserName(identity);
  return html`
    <div class="qs-card">
      ${renderCardHeader(icons.image, t("quickSettings.personal.title"))}
      <div class="qs-card__body">
        <div class="qs-personal-preview">
          ${renderLocalUserAvatarPreview(props.userName, props.userAvatar)}
          <div class="qs-personal-preview__copy">
            <div class="qs-personal-preview__title">${label}</div>
            <div class="muted">${t("quickSettings.thisBrowserOnly")}</div>
          </div>
        </div>
        <div class="qs-row">
          <label class="qs-field">
            <span class="qs-row__label">${t("quickSettings.personal.name")}</span>
            <input
              class="qs-field__input"
              type="text"
              maxlength="50"
              .value=${props.userName ?? ""}
              placeholder="You"
              @input=${(e: Event) => props.onUserNameChange?.((e.target as HTMLInputElement).value)}
            />
          </label>
        </div>
        <div class="qs-row">
          <label class="qs-field">
            <span class="qs-row__label">${t("quickSettings.personal.avatar")}</span>
            <input
              class="qs-field__input"
              type="text"
              maxlength="16"
              .value=${avatarText}
              placeholder="JD or 🦞"
              @input=${(e: Event) => {
                const value = (e.target as HTMLInputElement).value;
                props.onUserAvatarChange?.(value.trim() ? value : null);
              }}
            />
          </label>
        </div>
        <div class="qs-personal-actions">
          <label class="btn btn--sm">
            Choose image
            <input
              type="file"
              accept="image/*"
              hidden
              @change=${(e: Event) => handleLocalUserAvatarFileSelect(e, props)}
            />
          </label>
          <button
            type="button"
            class="btn btn--sm btn--ghost"
            ?disabled=${!hasLocalUserIdentity(identity)}
            @click=${() => {
              props.onUserNameChange?.("");
              props.onUserAvatarChange?.(null);
            }}
          >
            Clear
          </button>
        </div>
      </div>
    </div>
  `;
}

function renderToggleRow(label: string, checked: boolean, onChange: (next: boolean) => void) {
  return html`
    <div class="qs-row">
      <span class="qs-row__label">${label}</span>
      <label class="qs-toggle">
        <input
          type="checkbox"
          .checked=${checked}
          @change=${(e: Event) => onChange((e.target as HTMLInputElement).checked)}
        />
        <span class="qs-toggle__track"></span>
      </label>
    </div>
  `;
}

function renderLanguageChatCard(props: QuickSettingsProps) {
  return html`
    <div class="qs-card">
      ${renderCardHeader(icons.messageSquare, t("quickSettings.languageChat.title"))}
      <div class="qs-card__body">
        <div class="qs-row">
          <label class="qs-field">
            <span class="qs-row__label">${t("overview.access.language")}</span>
            <select
              class="qs-field__input"
              .value=${props.locale}
              @change=${(e: Event) =>
                props.onLocaleChange?.((e.target as HTMLSelectElement).value as Locale)}
            >
              ${SUPPORTED_LOCALES.map(
                (locale) => html`
                  <option value=${locale} ?selected=${locale === props.locale}>
                    ${t(`languages.${locale.replace("-", "")}`)}
                  </option>
                `,
              )}
            </select>
          </label>
        </div>
        ${renderToggleRow(
          t("quickSettings.languageChat.showThinking"),
          props.chatShowThinking,
          (next) => props.onChatDisplayChange?.({ chatShowThinking: next }),
        )}
        ${renderToggleRow(
          t("quickSettings.languageChat.showToolCalls"),
          props.chatShowToolCalls,
          (next) => props.onChatDisplayChange?.({ chatShowToolCalls: next }),
        )}
        <div class="muted qs-card__note">${t("quickSettings.thisBrowserOnly")}</div>
      </div>
    </div>
  `;
}

function renderPresetsCard(props: QuickSettingsProps) {
  const activePreset = props.configObject ? detectActivePreset(props.configObject) : null;
  const badge = activePreset
    ? undefined
    : html`<span class="qs-badge"
        >${props.configObject
          ? t("quickSettings.profile.custom")
          : t("quickSettings.profile.unknown")}</span
      >`;

  return html`
    <div class="qs-card qs-card--span-all">
      ${renderCardHeader(icons.zap, t("quickSettings.profile.title"), badge)}
      <div class="qs-card__body qs-presets-grid">
        ${CONFIG_PRESETS.map(
          (preset) => html`
            <button
              class="qs-preset ${preset.id === activePreset ? "qs-preset--active" : ""}"
              @click=${() => props.onApplyPreset?.(preset.id)}
            >
              <span class="qs-preset__icon">${preset.icon}</span>
              <span class="qs-preset__label">${preset.label}</span>
              <span class="qs-preset__desc muted">${preset.description}</span>
            </button>
          `,
        )}
      </div>
    </div>
  `;
}

function renderConnectionFooter(props: QuickSettingsProps) {
  return html`
    <div class="qs-footer">
      <div class="qs-footer__row">
        <span class="qs-status-dot ${props.connected ? "qs-status-dot--ok" : ""}"></span>
        <span class="muted">${props.connected ? t("common.connected") : t("common.offline")}</span>
        ${props.assistantName ? html`<span class="muted">· ${props.assistantName}</span>` : nothing}
        ${props.version ? html`<span class="muted">· v${props.version}</span>` : nothing}
      </div>
    </div>
  `;
}

function renderStack(...cards: TemplateResult[]) {
  return html`<div class="qs-stack">${cards}</div>`;
}

// ── Confirm dialog for risky config patches ──

export type QuickSettingsConfirm = {
  title: string;
  sub: string;
  patch: Record<string, unknown>;
};

export function renderQuickSettingsConfirm(
  confirm: QuickSettingsConfirm | null,
  cb: { busy: boolean; onCancel: () => void; onConfirm: () => void },
) {
  if (!confirm) {
    return nothing;
  }
  return dialogChrome({
    title: confirm.title,
    sub: confirm.sub,
    body: html``,
    busy: cb.busy,
    error: null,
    submitLabel: t("quickSettings.apply"),
    canSubmit: true,
    onCancel: cb.onCancel,
    onSubmit: cb.onConfirm,
  });
}

// ── Main render ──

export function renderQuickSettings(props: QuickSettingsProps) {
  return html`
    <div class="qs-container">
      <div class="qs-header">
        <h2 class="qs-header__title">${icons.settings} ${t("nav.settings")}</h2>
        <div class="qs-header__actions">
          <button class="btn btn--sm" @click=${props.onOpenBackups}>
            ${t("quickSettings.backups")}
          </button>
          <button class="btn btn--sm" @click=${props.onAdvancedSettings}>
            ${t("quickSettings.advanced")} ${icons.chevronRight}
          </button>
        </div>
      </div>

      <div class="qs-grid">
        ${renderStack(renderModelCard(props), renderSecurityCard(props))}
        ${renderStack(renderChannelsCard(props), renderAutomationsCard(props))}
        ${renderStack(renderApiKeysCard(props), renderAppearanceCard(props))}
        ${renderStack(renderPersonalCard(props), renderLanguageChatCard(props))}
        ${renderPresetsCard(props)}
      </div>

      ${renderConnectionFooter(props)}
    </div>
  `;
}
