import { html, nothing } from "lit";
import { t } from "../../i18n/index.ts";
import type { ModelProviderWizardTarget } from "../app-model-providers.ts";
import { icons } from "../icons.ts";
import type { ModelCatalogEntry } from "../types.ts";
import {
  renderModelProviderWizardDialog,
  type ModelProviderWizardDialogProps,
} from "./model-provider-wizard.ts";

export type ModelsPanel = "catalog" | "providers";

export interface ModelsProps extends ModelProviderWizardDialogProps {
  connected: boolean;
  loading: boolean;
  models: ModelCatalogEntry[];
  panel: ModelsPanel;
  error: string | null;
  onPanelChange: (panel: ModelsPanel) => void;
  onRefresh: () => void;
  onModelProviderWizardStart: (target?: ModelProviderWizardTarget) => void;
}

const MODELS_GRID = "grid-template-columns: 2fr 1fr 0.8fr 0.8fr;";
const PROVIDERS_GRID = "grid-template-columns: 2fr 0.8fr 1fr;";

function entryProvider(m: ModelCatalogEntry): string {
  return (m as { provider?: string }).provider ?? "—";
}

function entryContext(m: ModelCatalogEntry): string {
  const ctx = (m as { contextWindow?: number }).contextWindow;
  if (typeof ctx !== "number" || ctx <= 0) {
    return "—";
  }
  if (ctx >= 1_000_000) {
    return `${(ctx / 1_000_000).toFixed(ctx % 1_000_000 ? 1 : 0)}M`;
  }
  if (ctx >= 1000) {
    return `${Math.round(ctx / 1000)}K`;
  }
  return String(ctx);
}

function entryReasoning(m: ModelCatalogEntry): boolean {
  return Boolean((m as { reasoning?: boolean }).reasoning);
}

function renderCatalog(props: ModelsProps) {
  if (props.models.length === 0) {
    return html`<div class="muted" style="padding: 16px;">
      ${props.loading ? t("common.loading") : t("modelsView.empty")}
    </div>`;
  }
  return html`
    <div class="table">
      <div class="table-head" style=${MODELS_GRID}>
        <span>${t("modelsView.colModel")}</span>
        <span>${t("modelsView.colProvider")}</span>
        <span>${t("modelsView.colContext")}</span>
        <span>${t("modelsView.colReasoning")}</span>
      </div>
      ${props.models.map(
        (m) => html`
          <div class="table-row" style=${MODELS_GRID}>
            <span style="font-family: var(--mono); color: var(--text);">${m.id}</span>
            <span class="muted">${entryProvider(m)}</span>
            <span style="font-family: var(--mono);" class="muted">${entryContext(m)}</span>
            <span>
              ${entryReasoning(m)
                ? html`<span class="pill">${t("modelsView.reasoning")}</span>`
                : html`<span class="muted">—</span>`}
            </span>
          </div>
        `,
      )}
    </div>
  `;
}

function renderProviders(props: ModelsProps) {
  const counts = new Map<string, number>();
  for (const m of props.models) {
    const p = entryProvider(m);
    counts.set(p, (counts.get(p) ?? 0) + 1);
  }
  const providers = [...counts.entries()].toSorted((a, b) => a[0].localeCompare(b[0]));
  if (providers.length === 0) {
    return html`<div class="muted" style="padding: 16px;">
      ${props.loading ? t("common.loading") : t("modelsView.empty")}
    </div>`;
  }
  return html`
    <div class="table">
      <div class="table-head" style=${PROVIDERS_GRID}>
        <span>${t("modelsView.colProvider")}</span>
        <span>${t("modelsView.colModels")}</span>
        <span>${t("modelsView.colStatus")}</span>
      </div>
      ${providers.map(
        ([provider, count]) => html`
          <div class="table-row" style=${PROVIDERS_GRID}>
            <span style="font-weight: 500;">${provider}</span>
            <span style="font-family: var(--mono);" class="muted">${count}</span>
            <span class="row" style="gap: 8px; align-items: center;">
              <span class="status-dot status-dot--ok"></span>
              <span class="muted">${t("modelsView.connected")}</span>
            </span>
          </div>
        `,
      )}
    </div>
  `;
}

export function renderModels(props: ModelsProps) {
  const addingProvider = props.panel === "providers";
  const addLabel = addingProvider ? t("modelsView.addProvider") : t("modelsView.addModel");
  return html`
    <section class="card" style="border: none; background: transparent; padding: 0;">
      <div class="row" style="justify-content: space-between; align-items: flex-start;">
        <div>
          <div class="card-title">${t("tabs.models")}</div>
          <div class="card-sub">${t("subtitles.models")}</div>
        </div>
        <div class="row" style="gap: 8px; flex: none;">
          <button class="btn" ?disabled=${props.loading} @click=${props.onRefresh}>
            ${icons.refresh} ${props.loading ? t("common.loading") : t("common.refresh")}
          </button>
          <button
            class="btn primary"
            ?disabled=${!props.connected || props.modelProviderWizardBusy}
            @click=${() =>
              props.onModelProviderWizardStart(addingProvider ? "models" : "custom-model")}
          >
            ${icons.plus} ${addLabel}
          </button>
        </div>
      </div>

      <div class="agent-tabs" style="margin-top: 20px;">
        <button
          class="agent-tab ${props.panel === "catalog" ? "active" : ""}"
          @click=${() => props.onPanelChange("catalog")}
        >
          ${t("modelsView.tabModels")}
        </button>
        <button
          class="agent-tab ${props.panel === "providers" ? "active" : ""}"
          @click=${() => props.onPanelChange("providers")}
        >
          ${t("modelsView.tabProviders")}
        </button>
      </div>

      ${props.error
        ? html`<div class="callout danger" style="margin-top: 16px;">${props.error}</div>`
        : nothing}

      <div style="margin-top: 16px;">
        ${props.panel === "providers" ? renderProviders(props) : renderCatalog(props)}
      </div>
      ${renderModelProviderWizardDialog(props)}
    </section>
  `;
}
