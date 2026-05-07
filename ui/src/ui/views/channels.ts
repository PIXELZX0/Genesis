import { html, nothing } from "lit";
import { t } from "../../i18n/index.ts";
import { sortCopy } from "../array.ts";
import { formatRelativeTimestamp } from "../format.ts";
import { icons } from "../icons.ts";
import type {
  ChannelAccountSnapshot,
  ChannelUiMetaEntry,
  ChannelsStatusSnapshot,
  DiscordStatus,
  GoogleChatStatus,
  IMessageStatus,
  NostrProfile,
  NostrStatus,
  SignalStatus,
  SlackStatus,
  TelegramStatus,
  WhatsAppStatus,
} from "../types.ts";
import { renderChannelConfigSection } from "./channels.config.ts";
import { renderDiscordCard } from "./channels.discord.ts";
import { renderGoogleChatCard } from "./channels.googlechat.ts";
import { renderIMessageCard } from "./channels.imessage.ts";
import { renderNostrCard } from "./channels.nostr.ts";
import {
  channelEnabled,
  formatNullableBoolean,
  renderChannelAccountCount,
  resolveChannelDisplayState,
} from "./channels.shared.ts";
import { renderSignalCard } from "./channels.signal.ts";
import { renderSlackCard } from "./channels.slack.ts";
import { renderTelegramCard } from "./channels.telegram.ts";
import type { ChannelKey, ChannelsChannelData, ChannelsProps } from "./channels.types.ts";
import { renderWhatsAppCard } from "./channels.whatsapp.ts";

export function renderChannels(props: ChannelsProps) {
  const channels = props.snapshot?.channels as Record<string, unknown> | null;
  const whatsapp = (channels?.whatsapp ?? undefined) as WhatsAppStatus | undefined;
  const telegram = (channels?.telegram ?? undefined) as TelegramStatus | undefined;
  const discord = (channels?.discord ?? null) as DiscordStatus | null;
  const googlechat = (channels?.googlechat ?? null) as GoogleChatStatus | null;
  const slack = (channels?.slack ?? null) as SlackStatus | null;
  const signal = (channels?.signal ?? null) as SignalStatus | null;
  const imessage = (channels?.imessage ?? null) as IMessageStatus | null;
  const nostr = (channels?.nostr ?? null) as NostrStatus | null;
  const channelOrder = resolveChannelOrder(props.snapshot);
  const orderedChannels = sortCopy(
    channelOrder.map((key, index) => ({
      key,
      enabled: channelEnabled(key, props),
      order: index,
    })),
    (a, b) => {
      if (a.enabled !== b.enabled) {
        return a.enabled ? -1 : 1;
      }
      return a.order - b.order;
    },
  );

  return html`
    <section class="channels-toolbar">
      <div>
        <div class="card-title">${t("tabs.channels")}</div>
        <div class="card-sub">${t("channels.wizard.toolbarSubtitle")}</div>
      </div>
      <button
        class="btn primary"
        ?disabled=${!props.connected || props.channelWizardBusy}
        @click=${() => props.onChannelWizardStart()}
      >
        <span class="btn__icon">${icons.plus}</span>
        ${props.channelWizardBusy ? t("common.working") : t("channels.wizard.addChannel")}
      </button>
    </section>

    <section class="grid grid-cols-2">
      ${orderedChannels.map((channel) =>
        renderChannel(channel.key, props, {
          whatsapp,
          telegram,
          discord,
          googlechat,
          slack,
          signal,
          imessage,
          nostr,
          channelAccounts: props.snapshot?.channelAccounts ?? null,
        }),
      )}
    </section>

    <section class="card" style="margin-top: 18px;">
      <div class="row" style="justify-content: space-between;">
        <div>
          <div class="card-title">${t("channels.health.title")}</div>
          <div class="card-sub">${t("channels.health.subtitle")}</div>
        </div>
        <div class="muted">
          ${props.lastSuccessAt ? formatRelativeTimestamp(props.lastSuccessAt) : t("common.na")}
        </div>
      </div>
      ${props.lastError
        ? html`<div class="callout danger" style="margin-top: 12px;">${props.lastError}</div>`
        : nothing}
      <pre class="code-block" style="margin-top: 12px;">
${props.snapshot ? JSON.stringify(props.snapshot, null, 2) : t("channels.health.noSnapshotYet")}
      </pre
      >
    </section>

    ${renderChannelWizardDialog(props)}
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

function resolveChannelOrder(snapshot: ChannelsStatusSnapshot | null): ChannelKey[] {
  if (snapshot?.channelMeta?.length) {
    return snapshot.channelMeta.map((entry) => entry.id);
  }
  if (snapshot?.channelOrder?.length) {
    return snapshot.channelOrder;
  }
  return ["whatsapp", "telegram", "discord", "googlechat", "slack", "signal", "imessage", "nostr"];
}

function renderChannel(key: ChannelKey, props: ChannelsProps, data: ChannelsChannelData) {
  const accountCountLabel = renderChannelAccountCount(key, data.channelAccounts);
  switch (key) {
    case "whatsapp":
      return renderWhatsAppCard({
        props,
        whatsapp: data.whatsapp,
        accountCountLabel,
      });
    case "telegram":
      return renderTelegramCard({
        props,
        telegram: data.telegram,
        telegramAccounts: data.channelAccounts?.telegram ?? [],
        accountCountLabel,
      });
    case "discord":
      return renderDiscordCard({
        props,
        discord: data.discord,
        accountCountLabel,
      });
    case "googlechat":
      return renderGoogleChatCard({
        props,
        googleChat: data.googlechat,
        accountCountLabel,
      });
    case "slack":
      return renderSlackCard({
        props,
        slack: data.slack,
        accountCountLabel,
      });
    case "signal":
      return renderSignalCard({
        props,
        signal: data.signal,
        accountCountLabel,
      });
    case "imessage":
      return renderIMessageCard({
        props,
        imessage: data.imessage,
        accountCountLabel,
      });
    case "nostr": {
      const nostrAccounts = data.channelAccounts?.nostr ?? [];
      const primaryAccount = nostrAccounts[0];
      const accountId = primaryAccount?.accountId ?? "default";
      const profile =
        (primaryAccount as { profile?: NostrProfile | null } | undefined)?.profile ?? null;
      const showForm =
        props.nostrProfileAccountId === accountId ? props.nostrProfileFormState : null;
      const profileFormCallbacks = showForm
        ? {
            onFieldChange: props.onNostrProfileFieldChange,
            onSave: props.onNostrProfileSave,
            onImport: props.onNostrProfileImport,
            onCancel: props.onNostrProfileCancel,
            onToggleAdvanced: props.onNostrProfileToggleAdvanced,
          }
        : null;
      return renderNostrCard({
        props,
        nostr: data.nostr,
        nostrAccounts,
        accountCountLabel,
        profileFormState: showForm,
        profileFormCallbacks,
        onEditProfile: () => props.onNostrProfileEdit(accountId, profile),
      });
    }
    default:
      return renderGenericChannelCard(key, props, data.channelAccounts ?? {});
  }
}

function renderGenericChannelCard(
  key: ChannelKey,
  props: ChannelsProps,
  channelAccounts: Record<string, ChannelAccountSnapshot[]>,
) {
  const label = resolveChannelLabel(props.snapshot, key);
  const displayState = resolveChannelDisplayState(key, props);
  const lastError =
    typeof displayState.status?.lastError === "string" ? displayState.status.lastError : undefined;
  const accounts = channelAccounts[key] ?? [];
  const accountCountLabel = renderChannelAccountCount(key, channelAccounts);

  return html`
    <div class="card">
      <div class="card-title">${label}</div>
      <div class="card-sub">${t("channels.generic.subtitle")}</div>
      ${accountCountLabel}
      ${accounts.length > 0
        ? html`
            <div class="account-card-list">
              ${accounts.map((account) => renderGenericAccount(account))}
            </div>
          `
        : html`
            <div class="status-list" style="margin-top: 16px;">
              <div>
                <span class="label">${t("common.configured")}</span>
                <span>${formatNullableBoolean(displayState.configured)}</span>
              </div>
              <div>
                <span class="label">${t("common.running")}</span>
                <span>${formatNullableBoolean(displayState.running)}</span>
              </div>
              <div>
                <span class="label">${t("common.connected")}</span>
                <span>${formatNullableBoolean(displayState.connected)}</span>
              </div>
            </div>
          `}
      ${lastError
        ? html`<div class="callout danger" style="margin-top: 12px;">${lastError}</div>`
        : nothing}
      ${renderChannelConfigSection({ channelId: key, props })}
    </div>
  `;
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
  return meta?.label ?? snapshot?.channelLabels?.[key] ?? key;
}

const RECENT_ACTIVITY_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes

function hasRecentActivity(account: ChannelAccountSnapshot): boolean {
  if (!account.lastInboundAt) {
    return false;
  }
  return Date.now() - account.lastInboundAt < RECENT_ACTIVITY_THRESHOLD_MS;
}

function deriveRunningStatus(account: ChannelAccountSnapshot): string {
  if (account.running) {
    return t("common.yes");
  }
  // If we have recent inbound activity, the channel is effectively running
  if (hasRecentActivity(account)) {
    return t("common.active");
  }
  return t("common.no");
}

function deriveConnectedStatus(account: ChannelAccountSnapshot): string {
  if (account.connected === true) {
    return t("common.yes");
  }
  if (account.connected === false) {
    return t("common.no");
  }
  // If connected is null/undefined but we have recent activity, show as active
  if (hasRecentActivity(account)) {
    return t("common.active");
  }
  return t("common.na");
}

function renderGenericAccount(account: ChannelAccountSnapshot) {
  const runningStatus = deriveRunningStatus(account);
  const connectedStatus = deriveConnectedStatus(account);

  return html`
    <div class="account-card">
      <div class="account-card-header">
        <div class="account-card-title">${account.name || account.accountId}</div>
        <div class="account-card-id">${account.accountId}</div>
      </div>
      <div class="status-list account-card-status">
        <div>
          <span class="label">${t("common.running")}</span>
          <span>${runningStatus}</span>
        </div>
        <div>
          <span class="label">${t("common.configured")}</span>
          <span>${account.configured ? t("common.yes") : t("common.no")}</span>
        </div>
        <div>
          <span class="label">${t("common.connected")}</span>
          <span>${connectedStatus}</span>
        </div>
        <div>
          <span class="label">${t("common.lastInbound")}</span>
          <span
            >${account.lastInboundAt
              ? formatRelativeTimestamp(account.lastInboundAt)
              : t("common.na")}</span
          >
        </div>
        ${account.lastError
          ? html` <div class="account-card-error">${account.lastError}</div> `
          : nothing}
      </div>
    </div>
  `;
}
