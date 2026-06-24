import { html, nothing } from "lit";
import { t } from "../../i18n/index.ts";
import { sortCopy } from "../array.ts";
import { formatRelativeTimestamp } from "../format.ts";
import { icons } from "../icons.ts";
import type { ChannelUiMetaEntry, ChannelsStatusSnapshot } from "../types.ts";
import { renderChannelConfigSection } from "./channels.config.ts";
import {
  channelEnabled,
  getChannelAccountCount,
  resolveChannelDisplayState,
  resolveDefaultChannelAccount,
} from "./channels.shared.ts";
import type { ChannelKey, ChannelsProps } from "./channels.types.ts";

const CHANNELS_GRID = "grid-template-columns: 1.6fr 1fr 0.8fr 1fr 0.9fr;";

type ChannelStatus = { label: string; dot: string; online: boolean };

function resolveChannelStatus(key: ChannelKey, props: ChannelsProps): ChannelStatus {
  const state = resolveChannelDisplayState(key, props);
  const lastError =
    typeof state.status?.lastError === "string" ? state.status.lastError : undefined;
  if (lastError) {
    return { label: "Error", dot: "status-dot--error", online: false };
  }
  if (state.connected === true || state.running === true) {
    return { label: "Online", dot: "status-dot--ok", online: true };
  }
  if (state.configured === true || state.hasAnyActiveAccount) {
    return { label: "Idle", dot: "status-dot--idle", online: false };
  }
  return { label: "Offline", dot: "status-dot--idle", online: false };
}

function providerLabel(key: ChannelKey): string {
  return key.charAt(0).toUpperCase() + key.slice(1);
}

function resolveChannelMetaMap(
  snapshot: ChannelsStatusSnapshot | null,
): Record<string, ChannelUiMetaEntry> {
  if (!snapshot?.channelMeta?.length) {
    return {};
  }
  return Object.fromEntries(snapshot.channelMeta.map((entry) => [entry.id, entry]));
}

function resolveChannelLabel(snapshot: ChannelsStatusSnapshot | null, key: string): string {
  const meta = resolveChannelMetaMap(snapshot)[key];
  return meta?.label ?? snapshot?.channelLabels?.[key] ?? providerLabel(key);
}

function resolveChannelOrder(snapshot: ChannelsStatusSnapshot | null): ChannelKey[] {
  if (snapshot?.channelMeta?.length) {
    return snapshot.channelMeta.map((entry) => entry.id);
  }
  if (snapshot?.channelOrder?.length) {
    return snapshot.channelOrder;
  }
  return ["whatsapp", "telegram", "discord", "googlechat", "slack", "signal", "imessage", "nostr"];
}

function renderRow(key: ChannelKey, props: ChannelsProps) {
  const label = resolveChannelLabel(props.snapshot, key);
  const status = resolveChannelStatus(key, props);
  const accounts = getChannelAccountCount(key, props.snapshot?.channelAccounts ?? null);
  const defaultAccount = resolveDefaultChannelAccount(key, props);
  const lastInbound = defaultAccount?.lastInboundAt
    ? formatRelativeTimestamp(defaultAccount.lastInboundAt)
    : t("common.na");
  return html`
    <div
      class="table-row"
      style="cursor: pointer; ${CHANNELS_GRID}"
      title=${`Configure ${label}`}
      @click=${() => props.onChannelSelect(key)}
    >
      <span style="color: var(--text); display: flex; align-items: center; gap: 8px; min-width: 0;">
        <span class="status-dot ${status.dot}" style="flex: none;"></span>
        <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"
          >${label}</span
        >
      </span>
      <span class="muted">${providerLabel(key)}</span>
      <span class="muted" style="font-family: var(--mono);">${accounts}</span>
      <span class="muted" style="font-family: var(--mono);">${lastInbound}</span>
      <span class="muted">${status.label}</span>
    </div>
  `;
}

function renderChannelSettingsDialog(props: ChannelsProps) {
  const channelId = props.selectedChannelId;
  if (!channelId) {
    return nothing;
  }
  const label = resolveChannelLabel(props.snapshot, channelId);
  return html`
    <div class="exec-approval-overlay" role="dialog" aria-modal="true">
      <div class="exec-approval-card channel-settings-card">
        <div class="exec-approval-header">
          <div>
            <div class="exec-approval-title">${label} settings</div>
            <div class="exec-approval-sub">${providerLabel(channelId)}</div>
          </div>
          <button
            class="icon-btn"
            aria-label="Close"
            @click=${() => props.onChannelSettingsClose()}
          >
            ${icons.x}
          </button>
        </div>
        <div class="channel-settings__body">
          ${renderChannelConfigSection({ channelId, props })}
        </div>
      </div>
    </div>
  `;
}

export function renderChannels(props: ChannelsProps) {
  const channelOrder = resolveChannelOrder(props.snapshot);
  const ordered = sortCopy(
    channelOrder.map((key, index) => ({ key, enabled: channelEnabled(key, props), order: index })),
    (a, b) => {
      if (a.enabled !== b.enabled) {
        return a.enabled ? -1 : 1;
      }
      return a.order - b.order;
    },
  );
  const onlineCount = ordered.filter((c) => resolveChannelStatus(c.key, props).online).length;
  const idleCount = ordered.length - onlineCount;

  return html`
    <section class="card" style="border: none; background: transparent; padding: 0;">
      <div class="row" style="justify-content: space-between; align-items: flex-start; gap: 16px;">
        <div>
          <div class="view-title">${t("tabs.channels")}</div>
          <div class="view-sub">${onlineCount} connected · ${idleCount} idle</div>
        </div>
        <button
          class="btn primary"
          ?disabled=${!props.connected || props.channelWizardBusy}
          @click=${() => props.onChannelWizardStart()}
        >
          <span class="btn__icon">${icons.plus}</span>
          ${props.channelWizardBusy ? t("common.working") : t("channels.wizard.addChannel")}
        </button>
      </div>

      ${props.lastError
        ? html`<div class="callout danger" style="margin-top: 16px;">${props.lastError}</div>`
        : nothing}
      ${ordered.length === 0
        ? html`<div class="muted" style="padding: 16px;">
            ${props.loading ? t("common.loading") : t("common.na")}
          </div>`
        : html`
            <div class="table" style="margin-top: 20px;">
              <div class="table-head" style=${CHANNELS_GRID}>
                <span>CHANNEL</span>
                <span>PROVIDER</span>
                <span>ACCOUNTS</span>
                <span>LAST ACTIVITY</span>
                <span>STATUS</span>
              </div>
              ${ordered.map((channel) => renderRow(channel.key, props))}
            </div>
          `}
      ${renderChannelWizardDialog(props)} ${renderChannelSettingsDialog(props)}
    </section>
  `;
}

function renderChannelWizardDialog(props: ChannelsProps) {
  const step = props.channelWizardStep;
  const hasTerminalMessage = Boolean(props.channelWizardError || props.channelWizardMessage);
  if (!step && !props.channelWizardBusy && !hasTerminalMessage) {
    return nothing;
  }

  const title =
    step?.title ||
    (props.channelWizardError
      ? t("channels.wizard.errorTitle")
      : props.channelWizardMessage
        ? t("channels.wizard.doneTitle")
        : t("channels.wizard.title"));
  const message = step?.message ?? props.channelWizardError ?? props.channelWizardMessage ?? "";
  const canSubmit = Boolean(step) && !props.channelWizardBusy;

  return html`
    <div class="exec-approval-overlay" role="dialog" aria-modal="true" aria-live="polite">
      <div class="exec-approval-card channel-wizard-card">
        <div class="exec-approval-header">
          <div>
            <div class="exec-approval-title">${title}</div>
            <div class="exec-approval-sub">${t("channels.wizard.subtitle")}</div>
          </div>
        </div>
        ${message
          ? html`<div class="channel-wizard-message">${formatWizardMessage(message)}</div>`
          : nothing}
        ${step ? renderChannelWizardInput(props, step) : nothing}
        ${props.channelWizardError
          ? html`<div class="exec-approval-error">${props.channelWizardError}</div>`
          : nothing}
        <div class="exec-approval-actions">
          ${step
            ? html`
                <button
                  class="btn primary"
                  ?disabled=${!canSubmit}
                  @click=${() => props.onChannelWizardSubmit()}
                >
                  ${props.channelWizardBusy ? t("common.working") : t("channels.wizard.continue")}
                </button>
                <button
                  class="btn"
                  ?disabled=${props.channelWizardBusy}
                  @click=${() => props.onChannelWizardCancel()}
                >
                  ${t("common.cancel")}
                </button>
              `
            : html`
                <button
                  class="btn primary"
                  ?disabled=${props.channelWizardBusy}
                  @click=${() => props.onChannelWizardClose()}
                >
                  ${t("common.ok")}
                </button>
              `}
        </div>
      </div>
    </div>
  `;
}

function formatWizardMessage(message: string) {
  return message
    .split("\n")
    .map((line) => line.trimEnd())
    .map((line, index) => html`${index > 0 ? html`<br />` : nothing}${line}`);
}

function wizardValueKey(value: unknown): string {
  if (typeof value === "string") {
    return `string:${value}`;
  }
  try {
    return `json:${JSON.stringify(value)}`;
  } catch {
    return String(value);
  }
}

function wizardValueMatches(left: unknown, right: unknown): boolean {
  return wizardValueKey(left) === wizardValueKey(right);
}

function renderChannelWizardInput(
  props: ChannelsProps,
  step: NonNullable<ChannelsProps["channelWizardStep"]>,
) {
  if (step.type === "select") {
    return html`
      <div class="channel-wizard-options">
        ${(step.options ?? []).map((option) => {
          const selected = wizardValueMatches(props.channelWizardInput, option.value);
          return html`
            <button
              class=${selected ? "channel-wizard-option selected" : "channel-wizard-option"}
              ?disabled=${props.channelWizardBusy}
              @click=${() => props.onChannelWizardInput(option.value)}
            >
              <span>${option.label}</span>
              ${option.hint ? html`<small>${option.hint}</small>` : nothing}
            </button>
          `;
        })}
      </div>
    `;
  }
  if (step.type === "multiselect") {
    const current = Array.isArray(props.channelWizardInput) ? props.channelWizardInput : [];
    return html`
      <div class="channel-wizard-options">
        ${(step.options ?? []).map((option) => {
          const selected = current.some((value) => wizardValueMatches(value, option.value));
          const nextValue = selected
            ? current.filter((value) => !wizardValueMatches(value, option.value))
            : [...current, option.value];
          return html`
            <button
              class=${selected ? "channel-wizard-option selected" : "channel-wizard-option"}
              ?disabled=${props.channelWizardBusy}
              @click=${() => props.onChannelWizardInput(nextValue)}
            >
              <span>${option.label}</span>
              ${option.hint ? html`<small>${option.hint}</small>` : nothing}
            </button>
          `;
        })}
      </div>
    `;
  }
  if (step.type === "confirm") {
    return html`
      <div class="channel-wizard-confirm">
        <button
          class=${props.channelWizardInput === true ? "btn primary" : "btn"}
          ?disabled=${props.channelWizardBusy}
          @click=${() => props.onChannelWizardInput(true)}
        >
          ${t("common.yes")}
        </button>
        <button
          class=${props.channelWizardInput === false ? "btn primary" : "btn"}
          ?disabled=${props.channelWizardBusy}
          @click=${() => props.onChannelWizardInput(false)}
        >
          ${t("common.no")}
        </button>
      </div>
    `;
  }
  if (step.type === "text") {
    const value = typeof props.channelWizardInput === "string" ? props.channelWizardInput : "";
    return html`
      <input
        class="input channel-wizard-text"
        type=${step.sensitive ? "password" : "text"}
        .value=${value}
        placeholder=${step.placeholder ?? ""}
        ?disabled=${props.channelWizardBusy}
        @input=${(event: Event) =>
          props.onChannelWizardInput((event.currentTarget as HTMLInputElement).value)}
      />
    `;
  }
  return nothing;
}
