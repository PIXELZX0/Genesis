import { html, nothing } from "lit";
import { ref } from "lit/directives/ref.js";
import { t } from "../../i18n/index.ts";
import type {
  PluginClawHubDetail,
  PluginClawHubSearchResult,
  PluginMessageMap,
} from "../controllers/plugins.ts";
import { clampText } from "../format.ts";
import { icons } from "../icons.ts";
import { normalizeLowercaseStringOrEmpty } from "../string-coerce.ts";
import type { PluginStatusEntry, PluginStatusReport } from "../types.ts";

function showDialogWhenClosed(el?: Element) {
  if (!(el instanceof HTMLDialogElement) || el.open) {
    return;
  }
  queueMicrotask(() => {
    if (!el.isConnected || el.open) {
      return;
    }
    el.showModal();
  });
}

export type PluginsStatusFilter = "all" | "loaded" | "disabled" | "error" | "managed";

export type PluginsProps = {
  connected: boolean;
  loading: boolean;
  report: PluginStatusReport | null;
  error: string | null;
  filter: string;
  statusFilter: PluginsStatusFilter;
  busyKey: string | null;
  messages: PluginMessageMap;
  detailKey: string | null;
  clawhubQuery: string;
  clawhubResults: PluginClawHubSearchResult[] | null;
  clawhubSearchLoading: boolean;
  clawhubSearchError: string | null;
  clawhubDetail: PluginClawHubDetail | null;
  clawhubDetailName: string | null;
  clawhubDetailLoading: boolean;
  clawhubDetailError: string | null;
  clawhubInstallName: string | null;
  clawhubInstallMessage: { kind: "success" | "error"; text: string } | null;
  onFilterChange: (next: string) => void;
  onStatusFilterChange: (next: PluginsStatusFilter) => void;
  onRefresh: () => void;
  onToggle: (pluginId: string, enabled: boolean) => void;
  onUninstall: (pluginId: string) => void;
  onDetailOpen: (pluginId: string) => void;
  onDetailClose: () => void;
  onClawHubQueryChange: (query: string) => void;
  onClawHubDetailOpen: (name: string) => void;
  onClawHubDetailClose: () => void;
  onClawHubInstall: (name: string) => void;
};

const PLUGINS_GRID = "grid-template-columns: 1fr 120px 160px 90px;";

function pluginType(plugin: PluginStatusEntry): string {
  if (plugin.channelIds.length > 0) {
    return "channel";
  }
  if (plugin.providerIds.length > 0) {
    return "provider";
  }
  if (plugin.toolNames.length > 0) {
    return "tool";
  }
  if (plugin.commands.length > 0) {
    return "command";
  }
  if (plugin.agentHarnessIds.length > 0) {
    return "harness";
  }
  return plugin.format ?? plugin.origin ?? "plugin";
}

function pluginStatusClass(plugin: PluginStatusEntry): string {
  if (plugin.status === "error") {
    return "warn";
  }
  return plugin.status === "loaded" ? "ok" : "muted";
}

function capabilitySummary(plugin: PluginStatusEntry): string {
  const parts: string[] = [];
  if (plugin.channelIds.length > 0) {
    parts.push(`${plugin.channelIds.length} channel${plugin.channelIds.length === 1 ? "" : "s"}`);
  }
  if (plugin.providerIds.length > 0) {
    parts.push(
      `${plugin.providerIds.length} provider${plugin.providerIds.length === 1 ? "" : "s"}`,
    );
  }
  if (plugin.toolNames.length > 0) {
    parts.push(`${plugin.toolNames.length} tool${plugin.toolNames.length === 1 ? "" : "s"}`);
  }
  if (plugin.commands.length > 0) {
    parts.push(`${plugin.commands.length} command${plugin.commands.length === 1 ? "" : "s"}`);
  }
  if (plugin.agentHarnessIds.length > 0) {
    parts.push(
      `${plugin.agentHarnessIds.length} harness${plugin.agentHarnessIds.length === 1 ? "" : "es"}`,
    );
  }
  if (plugin.httpRoutes > 0) {
    parts.push(`${plugin.httpRoutes} HTTP route${plugin.httpRoutes === 1 ? "" : "s"}`);
  }
  return parts.length > 0 ? parts.join(", ") : "No advertised capabilities";
}

function installedFrom(plugin: PluginStatusEntry): string {
  const install = plugin.install;
  if (!install) {
    return plugin.origin === "bundled" ? "Bundled" : plugin.source;
  }
  if (install.source === "clawhub") {
    return install.clawhubPackage ? `ClawHub: ${install.clawhubPackage}` : "ClawHub";
  }
  if (install.source === "marketplace") {
    return install.marketplaceName ? `Marketplace: ${install.marketplaceName}` : "Marketplace";
  }
  return install.spec ?? install.source;
}

export function renderPlugins(props: PluginsProps) {
  const plugins = props.report?.plugins ?? [];
  const enabledCount = plugins.filter((p) => p.enabled && p.status !== "disabled").length;
  const filter = normalizeLowercaseStringOrEmpty(props.filter);
  const filtered = filter
    ? plugins.filter((plugin) =>
        normalizeLowercaseStringOrEmpty(
          [plugin.name, plugin.id, plugin.description, plugin.source, installedFrom(plugin)].join(
            " ",
          ),
        ).includes(filter),
      )
    : plugins;
  const detailPlugin = props.detailKey
    ? (plugins.find((plugin) => plugin.id === props.detailKey) ?? null)
    : null;

  return html`
    <section class="card" style="border: none; background: transparent; padding: 0;">
      <div class="row" style="justify-content: space-between; align-items: flex-start; gap: 16px;">
        <div>
          <div class="view-title">Plugins</div>
          <div class="view-sub">${plugins.length} installed · ${enabledCount} enabled</div>
        </div>
        <div class="data-table-search" style="width: 220px; flex: none;">
          ${icons.search}
          <input
            type="search"
            .value=${props.filter}
            placeholder="Search plugins"
            @input=${(e: Event) => props.onFilterChange((e.target as HTMLInputElement).value)}
          />
        </div>
      </div>

      ${props.error
        ? html`<div class="callout danger" style="margin-top: 16px;">${props.error}</div>`
        : nothing}
      ${props.report?.diagnostics?.length
        ? html`
            <div class="callout" style="margin-top: 12px;">
              ${props.report.diagnostics.length} plugin
              diagnostic${props.report.diagnostics.length === 1 ? "" : "s"}.
            </div>
          `
        : nothing}
      ${filtered.length === 0
        ? html`
            <div class="muted" style="padding: 16px;">
              ${!props.connected && !props.report
                ? "Not connected to gateway."
                : props.loading
                  ? t("common.loading")
                  : "No plugins found."}
            </div>
          `
        : html`
            <div class="table" style="margin-top: 20px;">
              <div class="table-head" style=${PLUGINS_GRID}>
                <span>PLUGIN</span>
                <span>VERSION</span>
                <span>TYPE</span>
                <span>ENABLED</span>
              </div>
              ${filtered.map((plugin) => renderPluginRow(plugin, props))}
            </div>
          `}

      <details class="card" style="margin-top: 24px;">
        <summary
          style="cursor: pointer; font-weight: 600; display: flex; align-items: center; gap: 8px;"
        >
          <span class="btn__icon">${icons.plus}</span> Install plugin from ClawHub
        </summary>
        <div style="margin-top: 16px;">
          <div style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap;">
            <label class="field" style="flex: 1; min-width: 180px;">
              <input
                .value=${props.clawhubQuery}
                @input=${(e: Event) =>
                  props.onClawHubQueryChange((e.target as HTMLInputElement).value)}
                placeholder="Search ClawHub plugins..."
                autocomplete="off"
                name="plugin-clawhub-search"
              />
            </label>
            ${props.clawhubSearchLoading ? html`<span class="muted">Searching...</span>` : nothing}
          </div>
          ${props.clawhubSearchError
            ? html`<div class="callout danger" style="margin-top: 8px;">
                ${props.clawhubSearchError}
              </div>`
            : nothing}
          ${props.clawhubInstallMessage
            ? html`<div
                class="callout ${props.clawhubInstallMessage.kind === "error"
                  ? "danger"
                  : "success"}"
                style="margin-top: 8px;"
              >
                ${props.clawhubInstallMessage.text}
              </div>`
            : nothing}
          ${renderClawHubResults(props)}
        </div>
      </details>
    </section>

    ${detailPlugin ? renderPluginDetail(detailPlugin, props) : nothing}
    ${props.clawhubDetailName ? renderClawHubDetailDialog(props) : nothing}
  `;
}

function renderClawHubResults(props: PluginsProps) {
  const results = props.clawhubResults;
  if (!results) {
    return nothing;
  }
  if (results.length === 0) {
    return html`<div class="muted" style="margin-top: 8px;">No plugins found on ClawHub.</div>`;
  }
  return html`
    <div class="list" style="margin-top: 8px;">
      ${results.map(({ package: pkg }) => {
        const installed = props.report?.plugins.some(
          (plugin) =>
            plugin.install?.clawhubPackage === pkg.name ||
            plugin.install?.spec === `clawhub:${pkg.name}` ||
            plugin.id === pkg.runtimeId,
        );
        return html`
          <div
            class="list-item list-item-clickable"
            @click=${() => props.onClawHubDetailOpen(pkg.name)}
          >
            <div class="list-main">
              <div class="list-title">${pkg.displayName}</div>
              <div class="list-sub">${pkg.summary ? clampText(pkg.summary, 130) : pkg.name}</div>
            </div>
            <div class="list-meta" style="display: flex; align-items: center; gap: 8px;">
              ${pkg.latestVersion
                ? html`<span class="muted" style="font-size: 12px;">v${pkg.latestVersion}</span>`
                : nothing}
              ${pkg.channel === "official"
                ? html`<span class="chip chip-ok">Official</span>`
                : html`<span class="chip">Community</span>`}
              <button
                class="btn btn--sm"
                ?disabled=${props.clawhubInstallName !== null || installed}
                @click=${(e: Event) => {
                  e.stopPropagation();
                  props.onClawHubInstall(pkg.name);
                }}
              >
                ${installed
                  ? "Installed"
                  : props.clawhubInstallName === pkg.name
                    ? "Installing..."
                    : "Install"}
              </button>
            </div>
          </div>
        `;
      })}
    </div>
  `;
}

function renderPluginRow(plugin: PluginStatusEntry, props: PluginsProps) {
  const busy = props.busyKey === plugin.id;
  const checked = plugin.enabled && plugin.status !== "disabled";
  return html`
    <div
      class="table-row"
      style="cursor: pointer; ${PLUGINS_GRID}"
      @click=${() => props.onDetailOpen(plugin.id)}
    >
      <div style="display: flex; flex-direction: column; gap: 2px; min-width: 0;">
        <span
          style="color: var(--text); font-weight: 500; display: flex; align-items: center; gap: 8px;"
        >
          <span class="statusDot ${pluginStatusClass(plugin)}"></span>
          ${plugin.name}
        </span>
        <span class="muted" style="font-size: 13px; overflow: hidden; text-overflow: ellipsis;">
          ${plugin.description ? clampText(plugin.description, 140) : capabilitySummary(plugin)}
        </span>
      </div>
      <span class="muted" style="font-family: var(--mono);">${plugin.version ?? "—"}</span>
      <span class="muted">${pluginType(plugin)}</span>
      <label class="skill-toggle-wrap" @click=${(e: Event) => e.stopPropagation()}>
        <input
          type="checkbox"
          class="skill-toggle"
          .checked=${checked}
          ?disabled=${busy}
          @change=${(e: Event) => {
            e.stopPropagation();
            props.onToggle(plugin.id, (e.target as HTMLInputElement).checked);
          }}
        />
      </label>
    </div>
  `;
}

function renderPluginDetail(plugin: PluginStatusEntry, props: PluginsProps) {
  const busy = props.busyKey === plugin.id;
  const message = props.messages[plugin.id] ?? null;
  const checked = plugin.enabled && plugin.status !== "disabled";
  const canUninstall = Boolean(plugin.install);

  return html`
    <dialog
      class="md-preview-dialog"
      ${ref(showDialogWhenClosed)}
      @click=${(e: Event) => {
        const dialog = e.currentTarget as HTMLDialogElement;
        if (e.target === dialog) {
          dialog.close();
        }
      }}
      @close=${props.onDetailClose}
    >
      <div class="md-preview-dialog__panel">
        <div class="md-preview-dialog__header">
          <div
            class="md-preview-dialog__title"
            style="display: flex; align-items: center; gap: 8px;"
          >
            <span class="statusDot ${pluginStatusClass(plugin)}"></span>
            <span>${plugin.name}</span>
          </div>
          <button
            class="btn btn--sm"
            @click=${(e: Event) => {
              (e.currentTarget as HTMLElement).closest("dialog")?.close();
            }}
          >
            Close
          </button>
        </div>
        <div class="md-preview-dialog__body" style="display: grid; gap: 16px;">
          <div>
            <div style="font-size: 14px; line-height: 1.5; color: var(--text);">
              ${plugin.description ?? capabilitySummary(plugin)}
            </div>
            <div style="display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px;">
              <span class="chip">${plugin.status}</span>
              <span class="chip">${plugin.format ?? "genesis"}</span>
              ${plugin.version ? html`<span class="chip">v${plugin.version}</span>` : nothing}
              ${plugin.install ? html`<span class="chip chip-ok">Managed</span>` : nothing}
            </div>
          </div>

          ${plugin.error ? html`<div class="callout danger">${plugin.error}</div>` : nothing}
          ${message
            ? html`<div class="callout ${message.kind === "error" ? "danger" : "success"}">
                ${message.message}
              </div>`
            : nothing}

          <div style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap;">
            <label class="skill-toggle-wrap">
              <input
                type="checkbox"
                class="skill-toggle"
                .checked=${checked}
                ?disabled=${busy}
                @change=${(e: Event) =>
                  props.onToggle(plugin.id, (e.target as HTMLInputElement).checked)}
              />
            </label>
            <span style="font-size: 13px; font-weight: 500;">
              ${checked ? "Enabled" : "Disabled"}
            </span>
            ${canUninstall
              ? html`<button
                  class="btn danger"
                  ?disabled=${busy}
                  @click=${() => {
                    if (confirm(`Uninstall plugin "${plugin.id}"?`)) {
                      props.onUninstall(plugin.id);
                    }
                  }}
                >
                  ${busy ? "Removing..." : "Uninstall"}
                </button>`
              : nothing}
          </div>

          <div
            style="border-top: 1px solid var(--border); padding-top: 12px; display: grid; gap: 6px; font-size: 12px; color: var(--muted);"
          >
            <div><span style="font-weight: 600;">ID:</span> ${plugin.id}</div>
            <div><span style="font-weight: 600;">Source:</span> ${plugin.source}</div>
            <div><span style="font-weight: 600;">Install:</span> ${installedFrom(plugin)}</div>
            ${plugin.rootDir
              ? html`<div style="font-family: var(--mono); word-break: break-all;">
                  ${plugin.rootDir}
                </div>`
              : nothing}
            <div>
              <span style="font-weight: 600;">Capabilities:</span> ${capabilitySummary(plugin)}
            </div>
          </div>
        </div>
      </div>
    </dialog>
  `;
}

function renderClawHubDetailDialog(props: PluginsProps) {
  const detail = props.clawhubDetail;
  const pkg = detail?.package ?? null;

  return html`
    <dialog
      class="md-preview-dialog"
      ${ref(showDialogWhenClosed)}
      @click=${(e: Event) => {
        const dialog = e.currentTarget as HTMLDialogElement;
        if (e.target === dialog) {
          dialog.close();
        }
      }}
      @close=${props.onClawHubDetailClose}
    >
      <div class="md-preview-dialog__panel">
        <div class="md-preview-dialog__header">
          <div class="md-preview-dialog__title">${pkg?.displayName ?? props.clawhubDetailName}</div>
          <button
            class="btn btn--sm"
            @click=${(e: Event) => {
              (e.currentTarget as HTMLElement).closest("dialog")?.close();
            }}
          >
            Close
          </button>
        </div>
        <div class="md-preview-dialog__body" style="display: grid; gap: 16px;">
          ${props.clawhubDetailLoading
            ? html`<div class="muted">${t("common.loading")}</div>`
            : props.clawhubDetailError
              ? html`<div class="callout danger">${props.clawhubDetailError}</div>`
              : pkg
                ? html`
                    <div style="font-size: 14px; line-height: 1.5;">${pkg.summary ?? ""}</div>
                    ${detail?.owner?.displayName
                      ? html`<div class="muted" style="font-size: 13px;">
                          By
                          ${detail.owner.displayName}${detail.owner.handle
                            ? html` (@${detail.owner.handle})`
                            : nothing}
                        </div>`
                      : nothing}
                    <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                      <span class="chip">${pkg.family}</span>
                      <span class="chip ${pkg.channel === "official" ? "chip-ok" : ""}">
                        ${pkg.channel}
                      </span>
                      ${pkg.latestVersion
                        ? html`<span class="chip">v${pkg.latestVersion}</span>`
                        : nothing}
                      ${pkg.verificationTier
                        ? html`<span class="chip">${pkg.verificationTier}</span>`
                        : nothing}
                    </div>
                    ${pkg.compatibility
                      ? html`<div class="muted" style="font-size: 13px;">
                          Compatibility:
                          ${[
                            pkg.compatibility.pluginApiRange
                              ? `plugin API ${pkg.compatibility.pluginApiRange}`
                              : "",
                            pkg.compatibility.minGatewayVersion
                              ? `min gateway ${pkg.compatibility.minGatewayVersion}`
                              : "",
                          ]
                            .filter(Boolean)
                            .join(", ")}
                        </div>`
                      : nothing}
                    ${pkg.verification?.summary
                      ? html`<div class="callout">${pkg.verification.summary}</div>`
                      : nothing}
                    <button
                      class="btn primary"
                      ?disabled=${props.clawhubInstallName !== null}
                      @click=${() => {
                        if (props.clawhubDetailName) {
                          props.onClawHubInstall(props.clawhubDetailName);
                        }
                      }}
                    >
                      ${props.clawhubInstallName === props.clawhubDetailName
                        ? "Installing..."
                        : `Install ${pkg.displayName}`}
                    </button>
                  `
                : html`<div class="muted">Plugin not found.</div>`}
        </div>
      </div>
    </dialog>
  `;
}
