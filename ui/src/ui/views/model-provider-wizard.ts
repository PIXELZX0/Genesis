import { html, nothing } from "lit";
import { t } from "../../i18n/index.ts";
import type { ModelProviderWizardStep } from "../app-model-providers.ts";

export interface ModelProviderWizardDialogProps {
  modelProviderWizardStep: ModelProviderWizardStep | null;
  modelProviderWizardInput: unknown;
  modelProviderWizardBusy: boolean;
  modelProviderWizardError: string | null;
  modelProviderWizardMessage: string | null;
  onModelProviderWizardSubmit: () => void;
  onModelProviderWizardCancel: () => void;
  onModelProviderWizardInput: (value: unknown) => void;
  onModelProviderWizardClose: () => void;
}

export function renderModelProviderWizardDialog(params: ModelProviderWizardDialogProps) {
  const step = params.modelProviderWizardStep;
  const hasTerminalMessage = Boolean(
    params.modelProviderWizardError || params.modelProviderWizardMessage,
  );
  if (!step && !params.modelProviderWizardBusy && !hasTerminalMessage) {
    return nothing;
  }

  const title =
    step?.title ||
    (params.modelProviderWizardError
      ? "Model provider setup failed"
      : params.modelProviderWizardMessage
        ? "Model provider connected"
        : "Connect model provider");
  const message =
    step?.message ?? params.modelProviderWizardError ?? params.modelProviderWizardMessage ?? "";
  const canSubmit = Boolean(step) && !params.modelProviderWizardBusy;

  return html`
    <div class="exec-approval-overlay" role="dialog" aria-modal="true" aria-live="polite">
      <div class="exec-approval-card channel-wizard-card">
        <div class="exec-approval-header">
          <div>
            <div class="exec-approval-title">${title}</div>
            <div class="exec-approval-sub">Provider credentials are saved on the Gateway.</div>
          </div>
        </div>
        ${message
          ? html`<div class="channel-wizard-message">${formatWizardMessage(message)}</div>`
          : nothing}
        ${step ? renderModelProviderWizardInput(params, step) : nothing}
        ${params.modelProviderWizardError
          ? html`<div class="exec-approval-error">${params.modelProviderWizardError}</div>`
          : nothing}
        <div class="exec-approval-actions">
          ${step
            ? html`
                <button
                  class="btn primary"
                  ?disabled=${!canSubmit}
                  @click=${params.onModelProviderWizardSubmit}
                >
                  ${params.modelProviderWizardBusy ? t("common.working") : "Continue"}
                </button>
                <button
                  class="btn"
                  ?disabled=${params.modelProviderWizardBusy}
                  @click=${params.onModelProviderWizardCancel}
                >
                  ${t("common.cancel")}
                </button>
              `
            : html`
                <button
                  class="btn primary"
                  ?disabled=${params.modelProviderWizardBusy}
                  @click=${params.onModelProviderWizardClose}
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

function renderModelProviderWizardInput(
  params: Pick<
    ModelProviderWizardDialogProps,
    "modelProviderWizardInput" | "modelProviderWizardBusy" | "onModelProviderWizardInput"
  >,
  step: ModelProviderWizardStep,
) {
  if (step.type === "select") {
    return html`
      <div class="channel-wizard-options">
        ${(step.options ?? []).map((option) => {
          const selected = wizardValueMatches(params.modelProviderWizardInput, option.value);
          return html`
            <button
              class=${selected ? "channel-wizard-option selected" : "channel-wizard-option"}
              ?disabled=${params.modelProviderWizardBusy}
              @click=${() => params.onModelProviderWizardInput(option.value)}
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
    const current = Array.isArray(params.modelProviderWizardInput)
      ? params.modelProviderWizardInput
      : [];
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
              ?disabled=${params.modelProviderWizardBusy}
              @click=${() => params.onModelProviderWizardInput(nextValue)}
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
          class=${params.modelProviderWizardInput === true ? "btn primary" : "btn"}
          ?disabled=${params.modelProviderWizardBusy}
          @click=${() => params.onModelProviderWizardInput(true)}
        >
          ${t("common.yes")}
        </button>
        <button
          class=${params.modelProviderWizardInput === false ? "btn primary" : "btn"}
          ?disabled=${params.modelProviderWizardBusy}
          @click=${() => params.onModelProviderWizardInput(false)}
        >
          ${t("common.no")}
        </button>
      </div>
    `;
  }
  if (step.type === "text") {
    const value =
      typeof params.modelProviderWizardInput === "string" ? params.modelProviderWizardInput : "";
    return html`
      <input
        class="input channel-wizard-text"
        type=${step.sensitive ? "password" : "text"}
        autocomplete=${step.sensitive ? "off" : "on"}
        .value=${value}
        placeholder=${step.placeholder ?? ""}
        ?disabled=${params.modelProviderWizardBusy}
        @input=${(event: Event) =>
          params.onModelProviderWizardInput((event.currentTarget as HTMLInputElement).value)}
      />
    `;
  }
  return nothing;
}
