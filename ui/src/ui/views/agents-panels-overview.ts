import { html, nothing } from "lit";
import { t } from "../../i18n/index.ts";
import type { ModelProviderWizardStep } from "../app-model-providers.ts";
import type {
  AgentIdentityResult,
  AgentsFilesListResult,
  AgentsListResult,
  ModelCatalogEntry,
} from "../types.ts";
import {
  buildModelOptions,
  normalizeModelValue,
  parseFallbackList,
  resolveAgentConfig,
  resolveModelFallbacks,
  resolveModelLabel,
  resolveModelPrimary,
} from "./agents-utils.ts";
import type { AgentsPanel } from "./agents.types.ts";

export function renderAgentOverview(params: {
  agent: AgentsListResult["agents"][number];
  basePath: string;
  defaultId: string | null;
  configForm: Record<string, unknown> | null;
  agentFilesList: AgentsFilesListResult | null;
  agentIdentity: AgentIdentityResult | null;
  agentIdentityLoading: boolean;
  agentIdentityError: string | null;
  configLoading: boolean;
  configSaving: boolean;
  configDirty: boolean;
  connected: boolean;
  modelCatalog: ModelCatalogEntry[];
  modelProviderWizardStep: ModelProviderWizardStep | null;
  modelProviderWizardInput: unknown;
  modelProviderWizardBusy: boolean;
  modelProviderWizardError: string | null;
  modelProviderWizardMessage: string | null;
  onConfigReload: () => void;
  onConfigSave: () => void;
  onModelChange: (agentId: string, modelId: string | null) => void;
  onModelFallbacksChange: (agentId: string, fallbacks: string[]) => void;
  onModelProviderWizardStart: () => void;
  onModelProviderWizardSubmit: () => void;
  onModelProviderWizardCancel: () => void;
  onModelProviderWizardInput: (value: unknown) => void;
  onModelProviderWizardClose: () => void;
  onSelectPanel: (panel: AgentsPanel) => void;
}) {
  const {
    agent,
    configForm,
    agentFilesList,
    configLoading,
    configSaving,
    configDirty,
    onConfigReload,
    onConfigSave,
    onModelChange,
    onModelFallbacksChange,
    onSelectPanel,
  } = params;
  const config = resolveAgentConfig(configForm, agent.id);
  const agentModel = agent.model;
  const workspaceFromFiles =
    agentFilesList && agentFilesList.agentId === agent.id ? agentFilesList.workspace : null;
  const workspace =
    workspaceFromFiles ||
    config.entry?.workspace ||
    config.defaults?.workspace ||
    agent.workspace ||
    "default";
  const model = config.entry?.model
    ? resolveModelLabel(config.entry?.model)
    : config.defaults?.model
      ? resolveModelLabel(config.defaults?.model)
      : resolveModelLabel(agentModel);
  const defaultModel = resolveModelLabel(config.defaults?.model ?? agentModel);
  const entryPrimary = resolveModelPrimary(config.entry?.model);
  const defaultPrimary =
    resolveModelPrimary(config.defaults?.model) ||
    (defaultModel !== "-" ? normalizeModelValue(defaultModel) : null) ||
    (configForm ? null : resolveModelPrimary(agentModel));
  const effectivePrimary = entryPrimary ?? defaultPrimary ?? null;
  const modelFallbacks =
    resolveModelFallbacks(config.entry?.model) ??
    resolveModelFallbacks(config.defaults?.model) ??
    (configForm ? null : resolveModelFallbacks(agentModel));
  const fallbackChips = modelFallbacks ?? [];
  const skillFilter = Array.isArray(config.entry?.skills) ? config.entry?.skills : null;
  const skillCount = skillFilter?.length ?? null;
  const isDefault = Boolean(params.defaultId && agent.id === params.defaultId);
  const disabled = !configForm || configLoading || configSaving;

  const removeChip = (index: number) => {
    const next = fallbackChips.filter((_, i) => i !== index);
    onModelFallbacksChange(agent.id, next);
  };

  const handleChipKeydown = (e: KeyboardEvent) => {
    const input = e.target as HTMLInputElement;
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      const parsed = parseFallbackList(input.value);
      if (parsed.length > 0) {
        onModelFallbacksChange(agent.id, [...fallbackChips, ...parsed]);
        input.value = "";
      }
    }
  };

  return html`
    <section class="card">
      <div class="card-title">Overview</div>
      <div class="card-sub">Workspace paths and identity metadata.</div>

      <div class="agents-overview-grid" style="margin-top: 16px;">
        <div class="agent-kv">
          <div class="label">Workspace</div>
          <div>
            <button
              type="button"
              class="workspace-link mono"
              @click=${() => onSelectPanel("files")}
              title="Open Files tab"
            >
              ${workspace}
            </button>
          </div>
        </div>
        <div class="agent-kv">
          <div class="label">Primary Model</div>
          <div class="mono">${model}</div>
        </div>
        <div class="agent-kv">
          <div class="label">Skills Filter</div>
          <div>${skillFilter ? `${skillCount} selected` : "all skills"}</div>
        </div>
      </div>

      ${configDirty
        ? html`
            <div class="callout warn" style="margin-top: 16px">
              You have unsaved config changes.
            </div>
          `
        : nothing}

      <div class="agent-model-select" style="margin-top: 20px;">
        <div class="label">Model Selection</div>
        <div class="agent-model-fields">
          <label class="field">
            <span>Primary model${isDefault ? " (default)" : ""}</span>
            <select
              .value=${isDefault ? (effectivePrimary ?? "") : (entryPrimary ?? "")}
              ?disabled=${disabled}
              @change=${(e: Event) =>
                onModelChange(agent.id, (e.target as HTMLSelectElement).value || null)}
            >
              ${isDefault
                ? html` <option value="">Not set</option> `
                : html`
                    <option value="">
                      ${defaultPrimary ? `Inherit default (${defaultPrimary})` : "Inherit default"}
                    </option>
                  `}
              ${buildModelOptions(configForm, effectivePrimary ?? undefined, params.modelCatalog)}
            </select>
          </label>
          <div class="field">
            <span>Fallbacks</span>
            <div
              class="agent-chip-input"
              @click=${(e: Event) => {
                const container = e.currentTarget as HTMLElement;
                const input = container.querySelector("input");
                if (input) {
                  input.focus();
                }
              }}
            >
              ${fallbackChips.map(
                (chip, i) => html`
                  <span class="chip">
                    ${chip}
                    <button
                      type="button"
                      class="chip-remove"
                      ?disabled=${disabled}
                      @click=${() => removeChip(i)}
                    >
                      &times;
                    </button>
                  </span>
                `,
              )}
              <input
                ?disabled=${disabled}
                placeholder=${fallbackChips.length === 0 ? "provider/model" : ""}
                @keydown=${handleChipKeydown}
                @blur=${(e: Event) => {
                  const input = e.target as HTMLInputElement;
                  const parsed = parseFallbackList(input.value);
                  if (parsed.length > 0) {
                    onModelFallbacksChange(agent.id, [...fallbackChips, ...parsed]);
                    input.value = "";
                  }
                }}
              />
            </div>
          </div>
        </div>
        <div class="agent-model-actions">
          <button
            type="button"
            class="btn btn--sm"
            ?disabled=${!params.connected || params.modelProviderWizardBusy}
            @click=${params.onModelProviderWizardStart}
          >
            ${params.modelProviderWizardBusy ? "Connecting..." : "Connect provider"}
          </button>
          <button
            type="button"
            class="btn btn--sm"
            ?disabled=${configLoading}
            @click=${onConfigReload}
          >
            ${t("common.reloadConfig")}
          </button>
          <button
            type="button"
            class="btn btn--sm primary"
            ?disabled=${configSaving || !configDirty}
            @click=${onConfigSave}
          >
            ${configSaving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </section>
    ${renderModelProviderWizardDialog(params)}
  `;
}

function renderModelProviderWizardDialog(params: {
  modelProviderWizardStep: ModelProviderWizardStep | null;
  modelProviderWizardInput: unknown;
  modelProviderWizardBusy: boolean;
  modelProviderWizardError: string | null;
  modelProviderWizardMessage: string | null;
  onModelProviderWizardSubmit: () => void;
  onModelProviderWizardCancel: () => void;
  onModelProviderWizardInput: (value: unknown) => void;
  onModelProviderWizardClose: () => void;
}) {
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
  params: {
    modelProviderWizardInput: unknown;
    modelProviderWizardBusy: boolean;
    onModelProviderWizardInput: (value: unknown) => void;
  },
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
