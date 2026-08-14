import { html, nothing } from "lit";
import { normalizeProviderId } from "../../../../src/agents/provider-id.js";
import { t } from "../../i18n/index.ts";
import type { ModelProviderWizardTarget } from "../app-model-providers.ts";
import { icons } from "../icons.ts";
import type {
  ModelAuthStatusProvider,
  ModelAuthStatusResult,
  ModelCatalogEntry,
} from "../types.ts";
import {
  renderModelProviderWizardDialog,
  type ModelProviderWizardDialogProps,
} from "./model-provider-wizard.ts";

export type ModelsPanel = "catalog" | "providers";

export interface ModelsProps extends ModelProviderWizardDialogProps {
  connected: boolean;
  loading: boolean;
  models: ModelCatalogEntry[];
  modelAuthStatus: ModelAuthStatusResult | null;
  panel: ModelsPanel;
  error: string | null;
  onPanelChange: (panel: ModelsPanel) => void;
  onRefresh: () => void;
  onModelProviderWizardStart: (target?: ModelProviderWizardTarget) => void;
}

const MODELS_GRID = "grid-template-columns: 2fr 1fr 0.8fr 0.8fr;";
const PROVIDERS_GRID = "grid-template-columns: 1.6fr 0.6fr 1fr 1.4fr;";

const STATUS_DOT: Record<string, string> = {
  ok: "status-dot--ok",
  static: "status-dot--ok",
  expiring: "status-dot--warn",
  expired: "status-dot--error",
  missing: "status-dot--error",
};

const STATUS_LABEL_KEY: Record<string, string> = {
  ok: "modelsView.statusConnected",
  static: "modelsView.statusApiKey",
  expiring: "modelsView.statusExpiring",
  expired: "modelsView.statusExpired",
  missing: "modelsView.statusAuthRequired",
};

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

// Catalog ids and auth-status ids can differ by alias (kimi-code -> kimi,
// bedrock -> amazon-bedrock, ...), so both sides go through the same
// normalizer or a provider would show up as two half-filled rows.
function providerKey(provider: string): string {
  return normalizeProviderId(provider);
}

function renderProviderStatus(auth: ModelAuthStatusProvider | undefined) {
  if (!auth) {
    return html`<span class="row" style="gap: 8px; align-items: center;">
      <span class="status-dot status-dot--idle"></span>
      <span class="muted">${t("modelsView.statusUnknown")}</span>
    </span>`;
  }
  const dot = STATUS_DOT[auth.status] ?? "status-dot--idle";
  const labelKey = STATUS_LABEL_KEY[auth.status] ?? "modelsView.statusUnknown";
  const expiry =
    auth.expiry && auth.status !== "static" && auth.expiry.label && auth.expiry.label !== "unknown"
      ? t("modelsView.expiresIn", { when: auth.expiry.label })
      : null;
  return html`<span class="row" style="gap: 8px; align-items: center;">
    <span class="status-dot ${dot}"></span>
    <span class="muted">${t(labelKey)}${expiry ? html` · ${expiry}` : nothing}</span>
  </span>`;
}

function renderProviderUsage(auth: ModelAuthStatusProvider | undefined) {
  const windows = auth?.usage?.windows ?? [];
  if (windows.length === 0) {
    return html`<span class="muted">—</span>`;
  }
  return html`<span class="row" style="gap: 10px; align-items: center; flex-wrap: wrap;">
    ${windows.map((w) => {
      // Providers can report usedPercent > 100 once a window is exhausted.
      const pctLeft = Math.max(0, Math.min(100, Math.round(100 - w.usedPercent)));
      const label = (w.label ?? "").trim();
      return html`<span class="muted" style="font-family: var(--mono);">
        ${label ? html`${label} ` : nothing}${t("modelsView.usageLeft", { pct: String(pctLeft) })}
      </span>`;
    })}
  </span>`;
}

function renderProviders(props: ModelsProps) {
  const counts = new Map<string, number>();
  const names = new Map<string, string>();
  for (const m of props.models) {
    const p = entryProvider(m);
    const key = providerKey(p);
    counts.set(key, (counts.get(key) ?? 0) + 1);
    names.set(key, names.get(key) ?? p);
  }
  const auth = new Map<string, ModelAuthStatusProvider>();
  for (const p of props.modelAuthStatus?.providers ?? []) {
    const key = providerKey(p.provider);
    auth.set(key, p);
    // Providers that are configured but have no catalog entries still belong in
    // the table — that is exactly the "Auth Required" case.
    names.set(key, p.displayName || names.get(key) || p.provider);
  }
  const providers = [...names.entries()].toSorted((a, b) => a[1].localeCompare(b[1]));
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
        <span>${t("modelsView.colUsage")}</span>
      </div>
      ${providers.map(
        ([key, name]) => html`
          <div class="table-row" style=${PROVIDERS_GRID}>
            <span style="font-weight: 500;">${name}</span>
            <span style="font-family: var(--mono);" class="muted">${counts.get(key) ?? 0}</span>
            ${renderProviderStatus(auth.get(key))} ${renderProviderUsage(auth.get(key))}
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
