import { html, nothing } from "lit";
import { t } from "../../i18n/index.ts";
import { sortCopy } from "../array.ts";
import type {
  McpMessage,
  McpOAuthFlow,
  McpOAuthStatus,
  McpServerMetadata,
  McpServersMap,
} from "../controllers/mcp.ts";

export type McpProps = {
  connected: boolean;
  loading: boolean;
  servers: McpServersMap | null;
  path: string | null;
  error: string | null;
  busy: boolean;
  message: McpMessage | null;
  addMode: "link" | "json";
  linkUrl: string;
  linkLoading: boolean;
  linkError: string | null;
  linkMetadata: McpServerMetadata | null;
  draftName: string;
  draftConfig: string;
  oauthStatus: Record<string, McpOAuthStatus>;
  oauthFlow: McpOAuthFlow | null;
  testStatus: Record<string, { ok: boolean; message: string } | null>;
  onAddModeChange: (mode: "link" | "json") => void;
  onLinkUrlChange: (next: string) => void;
  onLinkFetch: () => void;
  onLinkClear: () => void;
  onRefresh: () => void;
  onDraftNameChange: (value: string) => void;
  onDraftConfigChange: (value: string) => void;
  onEdit: (name: string) => void;
  onSave: () => void;
  onSaveMetadata: (metadata: McpServerMetadata) => void;
  onDelete: (name: string) => void;
  onTest: (name: string) => void;
  onOAuthConnect: (name: string) => void;
  onOAuthDisconnect: (name: string) => void;
  onOAuthCancel: () => void;
};

function summarizeTransport(server: Record<string, unknown>): string {
  const url = typeof server.url === "string" ? server.url : "";
  if (url) {
    const transport = typeof server.transport === "string" ? server.transport : "http";
    return `${transport} · ${url}`;
  }
  const command = typeof server.command === "string" ? server.command : "";
  if (command) {
    const args = Array.isArray(server.args) ? server.args.map((a) => String(a)).join(" ") : "";
    return `stdio · ${command}${args ? ` ${args}` : ""}`;
  }
  return "—";
}

function authBadgeFor(name: string, status: McpOAuthStatus | undefined) {
  if (!status) {
    return nothing;
  }
  if (status.connected) {
    return html`<span class="chip chip-ok">${t("mcpView.list.connected")}</span>`;
  }
  if (status.requiresAuth) {
    return html`<span class="chip chip-warn">${t("mcpView.list.oauthRequired")}</span>`;
  }
  return html`<span class="chip">${t("mcpView.list.notConnected")}</span>`;
}

const EXAMPLE_CONFIG = `{
  "url": "https://mcp.context7.com/mcp",
  "transport": "streamable-http"
}`;

export function renderMcp(props: McpProps) {
  const entries = props.servers
    ? sortCopy(Object.entries(props.servers), ([a], [b]) => a.localeCompare(b))
    : [];
  const canSave = props.draftName.trim().length > 0 && !props.busy;

  return html`
    <section class="card">
      <div style="display: flex; align-items: center; justify-content: space-between; gap: 12px;">
        <div>
          <div class="card-title">${t("mcpView.title")}</div>
          <div class="card-sub">${t("mcpView.subtitle")}</div>
        </div>
        <button class="btn btn--sm" ?disabled=${props.loading} @click=${props.onRefresh}>
          ${props.loading ? t("common.loading") : t("common.refresh")}
        </button>
      </div>

      ${props.path
        ? html`<div class="muted mono" style="margin-top: 8px;">
            Config: <span>${props.path}</span>
          </div>`
        : nothing}
      ${props.error
        ? html`<div class="callout danger" style="margin-top: 12px;">${props.error}</div>`
        : nothing}
      ${props.message
        ? html`<div
            class="callout ${props.message.kind === "error" ? "danger" : "success"}"
            style="margin-top: 12px;"
          >
            ${props.message.text}
          </div>`
        : nothing}
      ${props.oauthFlow ? renderOAuthBanner(props) : nothing}

      <div style="margin-top: 16px;">${renderAddPanel(props, canSave)}</div>

      ${!props.servers
        ? html`<div class="callout info" style="margin-top: 16px;">${t("common.loading")}</div>`
        : entries.length === 0
          ? html`<div class="muted" style="margin-top: 16px;">
              ${t("mcpView.list.empty")}
              <div class="muted" style="font-size: 13px; margin-top: 4px;">
                ${t("mcpView.list.emptyHint")}
              </div>
            </div>`
          : html`
              <div class="list" style="margin-top: 16px;">
                ${entries.map(([name, server]) => renderServerRow(name, server, props))}
              </div>
            `}
    </section>
  `;
}

function renderAddPanel(props: McpProps, canSaveJson: boolean) {
  return html`
    <div
      style="border: 1px solid var(--border); border-radius: 8px; padding: 14px; background: var(--surface-2, transparent);"
    >
      <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 12px;">
        <div style="font-weight: 600;">${t("mcpView.add.title")}</div>
        <div style="display: flex; gap: 6px; margin-left: auto;">
          <button
            class="btn btn--sm ${props.addMode === "link" ? "primary" : "ghost"}"
            @click=${() => props.onAddModeChange("link")}
            type="button"
          >
            ${t("mcpView.add.tabLink")}
          </button>
          <button
            class="btn btn--sm ${props.addMode === "json" ? "primary" : "ghost"}"
            @click=${() => props.onAddModeChange("json")}
            type="button"
          >
            ${t("mcpView.add.tabJson")}
          </button>
        </div>
      </div>
      ${props.addMode === "link" ? renderLinkForm(props) : renderJsonForm(props, canSaveJson)}
    </div>
  `;
}

function renderLinkForm(props: McpProps) {
  return html`
    <div>
      <label class="field" style="margin-bottom: 10px;">
        <span>${t("mcpView.add.link.label")}</span>
        <input
          .value=${props.linkUrl}
          @input=${(e: Event) => props.onLinkUrlChange((e.target as HTMLInputElement).value)}
          placeholder=${t("mcpView.add.link.placeholder")}
          autocomplete="off"
          name="mcp-link-url"
          @keydown=${(e: KeyboardEvent) => {
            if (e.key === "Enter") {
              e.preventDefault();
              props.onLinkFetch();
            }
          }}
        />
      </label>
      <div style="display: flex; gap: 8px;">
        <button
          class="btn btn--sm primary"
          ?disabled=${props.linkLoading || !props.linkUrl.trim() || !props.connected}
          @click=${props.onLinkFetch}
        >
          ${props.linkLoading ? t("mcpView.add.link.fetching") : t("mcpView.add.link.fetch")}
        </button>
        ${props.linkMetadata || props.linkError
          ? html`
              <button class="btn btn--sm ghost" @click=${props.onLinkClear}>
                ${t("mcpView.add.link.cancel")}
              </button>
            `
          : nothing}
      </div>
      ${props.linkError
        ? html`<div class="callout danger" style="margin-top: 10px;">
            ${t("mcpView.add.link.unsupportedTitle")}: ${props.linkError}
            <div class="muted" style="font-size: 13px; margin-top: 4px;">
              ${t("mcpView.add.link.unsupportedHint")}
            </div>
          </div>`
        : nothing}
      ${props.linkMetadata ? renderMetadataPreview(props) : nothing}
    </div>
  `;
}

function renderMetadataPreview(props: McpProps) {
  const metadata = props.linkMetadata!;
  return html`
    <div
      style="margin-top: 14px; padding: 12px; border: 1px solid var(--border); border-radius: 6px;"
    >
      <div style="font-weight: 600; margin-bottom: 6px;">${t("mcpView.add.link.previewTitle")}</div>
      <div style="display: grid; grid-template-columns: max-content 1fr; gap: 4px 12px;">
        <div class="muted">${t("mcpView.add.link.nameLabel")}</div>
        <div>
          <input
            .value=${props.draftName || metadata.name}
            @input=${(e: Event) => props.onDraftNameChange((e.target as HTMLInputElement).value)}
            autocomplete="off"
            name="mcp-link-name"
          />
        </div>
        <div class="muted">${t("mcpView.add.link.transportLabel")}</div>
        <div class="mono" style="overflow-wrap: anywhere;">${metadata.transport}</div>
        <div class="muted">URL</div>
        <div class="mono" style="overflow-wrap: anywhere;">${metadata.url}</div>
        ${metadata.serverName
          ? html`
              <div class="muted">Server</div>
              <div>
                ${metadata.serverName}${metadata.serverVersion
                  ? html` <span class="muted">v${metadata.serverVersion}</span>`
                  : nothing}
              </div>
            `
          : nothing}
        ${metadata.capabilities?.tools?.length
          ? html`
              <div class="muted">Tools</div>
              <div>${metadata.capabilities.tools.join(", ")}</div>
            `
          : nothing}
        ${metadata.oauth
          ? html`
              <div class="muted">OAuth</div>
              <div>
                <span class="chip chip-warn">${t("mcpView.list.oauthRequired")}</span>
                ${metadata.oauthIssuer
                  ? html`<span class="muted mono" style="margin-left: 6px;"
                      >${metadata.oauthIssuer}</span
                    >`
                  : nothing}
              </div>
            `
          : nothing}
      </div>
      <div style="display: flex; gap: 8px; margin-top: 12px;">
        <button
          class="btn btn--sm primary"
          ?disabled=${props.busy || !props.connected}
          @click=${() => props.onSaveMetadata(metadata)}
        >
          ${props.busy ? t("common.loading") : t("mcpView.add.link.save")}
        </button>
        <button class="btn btn--sm ghost" @click=${props.onLinkClear}>
          ${t("mcpView.add.link.cancel")}
        </button>
      </div>
    </div>
  `;
}

function renderJsonForm(props: McpProps, canSave: boolean) {
  return html`
    <div>
      <label class="field" style="margin-bottom: 10px;">
        <span>${t("mcpView.add.json.nameLabel")}</span>
        <input
          .value=${props.draftName}
          @input=${(e: Event) => props.onDraftNameChange((e.target as HTMLInputElement).value)}
          placeholder=${t("mcpView.add.json.namePlaceholder")}
          autocomplete="off"
          name="mcp-json-name"
        />
      </label>
      <label class="field agent-file-field">
        <span>${t("mcpView.add.json.configLabel")}</span>
        <textarea
          class="agent-file-textarea"
          .value=${props.draftConfig}
          @input=${(e: Event) => props.onDraftConfigChange((e.target as HTMLTextAreaElement).value)}
          placeholder=${EXAMPLE_CONFIG}
          spellcheck="false"
        ></textarea>
      </label>
      <div class="muted" style="font-size: 13px; margin-top: 6px;">
        ${t("mcpView.add.json.configHint")}
      </div>
      <div style="display: flex; gap: 8px; margin-top: 10px;">
        <button
          class="btn btn--sm primary"
          ?disabled=${!canSave || !props.connected}
          @click=${props.onSave}
        >
          ${props.busy
            ? t("common.loading")
            : props.draftName &&
                props.servers &&
                Object.prototype.hasOwnProperty.call(props.servers, props.draftName)
              ? t("mcpView.add.json.update")
              : t("mcpView.add.json.save")}
        </button>
      </div>
    </div>
  `;
}

function renderOAuthBanner(props: McpProps) {
  const flow = props.oauthFlow!;
  if (flow.error) {
    return html`<div class="callout danger" style="margin-top: 12px;">
      ${t("mcpView.oauth.failed", { message: flow.error })}
    </div>`;
  }
  return html`<div class="callout info" style="margin-top: 12px;">
    <div style="display: flex; align-items: center; gap: 12px;">
      <div>
        <div style="font-weight: 600;">${t("mcpView.oauth.title", { name: flow.name })}</div>
        <div class="muted" style="font-size: 13px;">${t("mcpView.oauth.subtitle")}</div>
      </div>
      <div style="display: flex; gap: 8px; margin-left: auto;">
        <a
          class="btn btn--sm primary"
          href=${flow.authorizeUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          ${t("mcpView.oauth.open")}
        </a>
        <button class="btn btn--sm ghost" @click=${props.onOAuthCancel}>
          ${t("mcpView.oauth.waiting")}
        </button>
      </div>
    </div>
  </div>`;
}

function renderServerRow(name: string, server: Record<string, unknown>, props: McpProps) {
  const status = props.oauthStatus[name];
  const test = props.testStatus[name];
  const isOauthServer = status?.requiresAuth ?? false;
  return html`
    <div
      class="list-item"
      style="display: flex; align-items: center; justify-content: space-between; gap: 12px;"
    >
      <div style="min-width: 0; flex: 1;">
        <div
          style="font-weight: 600; display: flex; align-items: center; gap: 8px; flex-wrap: wrap;"
        >
          <span>${name}</span>
          ${authBadgeFor(name, status)}
        </div>
        <div class="muted mono" style="overflow-wrap: anywhere;">${summarizeTransport(server)}</div>
        ${test
          ? html`<div
              class="muted"
              style="font-size: 12px; margin-top: 2px; color: ${test.ok
                ? "var(--ok, inherit)"
                : "var(--danger, inherit)"};"
            >
              ${test.ok ? "✓" : "✗"} ${test.message}
            </div>`
          : nothing}
      </div>
      <div
        style="display: flex; gap: 6px; flex-shrink: 0; flex-wrap: wrap; justify-content: flex-end;"
      >
        ${isOauthServer
          ? status?.connected
            ? html`
                <button
                  class="btn btn--sm"
                  ?disabled=${props.busy}
                  @click=${() => props.onOAuthConnect(name)}
                >
                  ${t("mcpView.list.reconnect")}
                </button>
                <button
                  class="btn btn--sm ghost"
                  ?disabled=${props.busy}
                  @click=${() => props.onOAuthDisconnect(name)}
                >
                  ${t("mcpView.list.disconnect")}
                </button>
              `
            : html`
                <button
                  class="btn btn--sm primary"
                  ?disabled=${props.busy || !!props.oauthFlow}
                  @click=${() => props.onOAuthConnect(name)}
                >
                  ${t("mcpView.list.connect")}
                </button>
              `
          : nothing}
        <button
          class="btn btn--sm ghost"
          ?disabled=${props.busy}
          @click=${() => props.onTest(name)}
        >
          ${t("mcpView.list.test")}
        </button>
        <button
          class="btn btn--sm ghost"
          ?disabled=${props.busy}
          @click=${() => props.onEdit(name)}
        >
          ${t("mcpView.list.edit")}
        </button>
        <button
          class="btn btn--sm ghost"
          ?disabled=${props.busy}
          @click=${() => props.onDelete(name)}
        >
          ${t("mcpView.list.delete")}
        </button>
      </div>
    </div>
  `;
}
