import { html, nothing, type TemplateResult } from "lit";
import { t } from "../../i18n/index.ts";

export interface CreateAgentForm {
  name: string;
  workspace: string;
  model: string;
}

export type AgentsCreateDialog = { form: CreateAgentForm; busy: boolean; error: string | null };

export function emptyAgentsCreateDialog(): AgentsCreateDialog {
  return { form: { name: "", workspace: "", model: "" }, busy: false, error: null };
}

export function setAgentsCreateDialogField(
  dialog: AgentsCreateDialog,
  field: string,
  value: string,
): AgentsCreateDialog {
  return { ...dialog, form: { ...dialog.form, [field]: value } };
}

interface DialogChrome {
  title: string;
  sub: string;
  body: TemplateResult;
  busy: boolean;
  error: string | null;
  submitLabel: string;
  canSubmit: boolean;
  onCancel: () => void;
  onSubmit: () => void;
}

function field(
  label: string,
  value: string,
  onInput: (value: string) => void,
  opts: { placeholder?: string; type?: string; list?: string } = {},
): TemplateResult {
  return html`
    <label class="field full">
      <span>${label}</span>
      <input
        type=${opts.type ?? "text"}
        .value=${value}
        list=${opts.list ?? nothing}
        placeholder=${opts.placeholder ?? nothing}
        @input=${(e: Event) => onInput((e.target as HTMLInputElement).value)}
      />
    </label>
  `;
}

function dialogChrome(c: DialogChrome): TemplateResult {
  return html`
    <div
      class="exec-approval-overlay"
      role="dialog"
      aria-modal="true"
      @click=${(event: Event) => {
        if (event.target === event.currentTarget && !c.busy) {
          c.onCancel();
        }
      }}
    >
      <div class="exec-approval-card" @click=${(e: Event) => e.stopPropagation()}>
        <div class="exec-approval-header">
          <div>
            <div class="exec-approval-title">${c.title}</div>
            <div class="exec-approval-sub">${c.sub}</div>
          </div>
        </div>
        ${c.error
          ? html`<div class="callout danger" style="margin-top: 12px;">${c.error}</div>`
          : nothing}
        <div style="display: grid; gap: 12px; margin-top: 16px;">${c.body}</div>
        <div class="row" style="justify-content: flex-end; gap: 8px; margin-top: 20px;">
          <button type="button" class="btn" ?disabled=${c.busy} @click=${c.onCancel}>
            ${t("common.cancel")}
          </button>
          <button
            type="button"
            class="btn primary"
            ?disabled=${c.busy || !c.canSubmit}
            @click=${c.onSubmit}
          >
            ${c.busy ? t("common.loading") : c.submitLabel}
          </button>
        </div>
      </div>
    </div>
  `;
}

export interface AgentsCreateDialogCallbacks {
  models: string[];
  onFieldChange: (field: string, value: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}

export function renderAgentsCreateDialog(
  dialog: AgentsCreateDialog | null,
  cb: AgentsCreateDialogCallbacks,
): TemplateResult | typeof nothing {
  if (!dialog) {
    return nothing;
  }
  const set = (key: string) => (value: string) => cb.onFieldChange(key, value);
  const f = dialog.form;
  return dialogChrome({
    title: t("agentsView.createTitle"),
    sub: t("agentsView.createSub"),
    busy: dialog.busy,
    error: dialog.error,
    submitLabel: t("agentsView.create"),
    canSubmit: f.name.trim() !== "" && f.workspace.trim() !== "",
    onCancel: cb.onCancel,
    onSubmit: cb.onSubmit,
    body: html`
      ${field(t("agentsView.fieldName"), f.name, set("name"), { placeholder: "research-bot" })}
      ${field(t("agentsView.fieldWorkspace"), f.workspace, set("workspace"), {
        placeholder: "~/genesis/research-bot",
      })}
      ${field(t("agentsView.fieldModel"), f.model, set("model"), {
        placeholder: "anthropic/claude-opus-4-8",
        list: "agents-model-suggestions",
      })}
      <datalist id="agents-model-suggestions">
        ${cb.models.map((m) => html`<option value=${m}></option>`)}
      </datalist>
    `,
  });
}
