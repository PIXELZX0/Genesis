import { html, nothing } from "lit";
import { t } from "../../i18n/index.ts";
import { sortCopy } from "../array.ts";
import type {
  McpEmbeddedFlow,
  McpEmbeddedInput,
  McpMessage,
  McpOAuthFlow,
  McpOAuthStatus,
  McpServerMetadata,
  McpServersMap,
} from "../controllers/mcp.ts";
import { icons } from "../icons.ts";
import { MCP_PRESETS, type McpPreset } from "./mcp-presets.ts";

const MCP_GRID = "grid-template-columns: 1fr 150px 90px 130px auto;";

function transportKind(server: Record<string, unknown>): string {
  if (typeof server.url === "string" && server.url) {
    return typeof server.transport === "string" ? server.transport : "http";
  }
  if (typeof server.command === "string" && server.command) {
    return "stdio";
  }
  return "—";
}

function mcpStatus(
  status: McpOAuthStatus | undefined,
  test: { ok: boolean; message: string } | null | undefined,
  isOauth: boolean,
): { dot: string; label: string } {
  if (test) {
    return test.ok
      ? { dot: "status-dot--ok", label: "Online" }
      : { dot: "status-dot--error", label: "Error" };
  }
  if (isOauth) {
    return status?.connected
      ? { dot: "status-dot--ok", label: t("mcpView.list.connected") }
      : { dot: "status-dot--idle", label: t("mcpView.list.oauthRequired") };
  }
  return { dot: "status-dot--idle", label: "—" };
}

export type McpAddMode = "preset" | "link" | "json";

export type McpProps = {
  connected: boolean;
  loading: boolean;
  servers: McpServersMap | null;
  path: string | null;
  error: string | null;
  busy: boolean;
  message: McpMessage | null;
  addMode: McpAddMode;
  linkUrl: string;
  linkLoading: boolean;
  linkError: string | null;
  linkMetadata: McpServerMetadata | null;
  draftName: string;
  draftConfig: string;
  /** Operator-supplied bearer token, shared by the link preview and presets. */
  authToken: string;
  /** Id of the currently selected preset, if any. */
  presetId: string | null;
  oauthStatus: Record<string, McpOAuthStatus>;
  oauthFlow: McpOAuthFlow | null;
  embeddedFlow: McpEmbeddedFlow | null;
  testStatus: Record<string, { ok: boolean; message: string } | null>;
  onAddModeChange: (mode: McpAddMode) => void;
  onLinkUrlChange: (next: string) => void;
  onLinkFetch: () => void;
  onLinkClear: () => void;
  onRefresh: () => void;
  onDraftNameChange: (value: string) => void;
  onDraftConfigChange: (value: string) => void;
  onAuthTokenChange: (value: string) => void;
  onPresetSelect: (preset: McpPreset) => void;
  onPresetSave: (preset: McpPreset) => void;
  onEdit: (name: string) => void;
  onSave: () => void;
  onSaveMetadata: (metadata: McpServerMetadata) => void;
  onDelete: (name: string) => void;
  onTest: (name: string) => void;
  onOAuthConnect: (name: string) => void;
  onOAuthDisconnect: (name: string) => void;
  onOAuthCancel: () => void;
  onEmbeddedInput: (ev: McpEmbeddedInput) => void;
  onEmbeddedCancel: () => void;
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

function serverDeclaresOauth(server: Record<string, unknown>): boolean {
  const auth = server.auth;
  if (!auth || typeof auth !== "object") {
    return false;
  }
  return (auth as Record<string, unknown>).type === "oauth";
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
    <section class="card" style="border: none; background: transparent; padding: 0;">
      <div class="row" style="justify-content: space-between; align-items: flex-start; gap: 16px;">
        <div>
          <div class="view-title">${t("mcpView.title")}</div>
          <div class="view-sub">
            ${entries.length} ${entries.length === 1 ? "server" : "servers"}
          </div>
        </div>
        <button class="btn" ?disabled=${props.loading} @click=${props.onRefresh}>
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
      ${props.embeddedFlow ? renderEmbeddedViewport(props) : nothing}
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
              <div class="table" style="margin-top: 20px;">
                <div class="table-head" style=${MCP_GRID}>
                  <span>SERVER</span>
                  <span>TRANSPORT</span>
                  <span>TOOLS</span>
                  <span>STATUS</span>
                  <span></span>
                </div>
                ${entries.map(([name, server]) => renderServerRow(name, server, props))}
              </div>
            `}

      <details class="card" style="margin-top: 24px;">
        <summary
          style="cursor: pointer; font-weight: 600; display: flex; align-items: center; gap: 8px;"
        >
          <span class="btn__icon">${icons.plus}</span> ${t("mcpView.add.title")}
        </summary>
        <div style="margin-top: 16px;">${renderAddPanel(props, canSave)}</div>
      </details>
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
            class="btn btn--sm ${props.addMode === "preset" ? "primary" : "ghost"}"
            @click=${() => props.onAddModeChange("preset")}
            type="button"
          >
            ${t("mcpView.add.tabPreset")}
          </button>
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
      ${props.addMode === "preset"
        ? renderPresetForm(props)
        : props.addMode === "link"
          ? renderLinkForm(props)
          : renderJsonForm(props, canSaveJson)}
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
      ${metadata.oauth
        ? nothing
        : renderAuthTokenField(props, {
            label: t("mcpView.add.token.label"),
            hint: t("mcpView.add.token.hint"),
          })}
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

/** Reusable password-style token input. Used by the link preview and presets. */
function renderAuthTokenField(props: McpProps, opts: { label: string; hint: string }) {
  return html`
    <label class="field" style="margin-top: 12px;">
      <span>${opts.label}</span>
      <input
        type="password"
        .value=${props.authToken}
        @input=${(e: Event) => props.onAuthTokenChange((e.target as HTMLInputElement).value)}
        placeholder=${t("mcpView.add.token.placeholder")}
        autocomplete="off"
        name="mcp-auth-token"
        spellcheck="false"
      />
    </label>
    <div class="muted" style="font-size: 13px; margin-top: 4px;">${opts.hint}</div>
  `;
}

function renderPresetForm(props: McpProps) {
  const selected = MCP_PRESETS.find((p) => p.id === props.presetId);
  return html`
    <div>
      <div class="muted" style="font-size: 13px; margin-bottom: 12px;">
        ${t("mcpView.add.preset.intro")}
      </div>
      <div
        style="display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 8px;"
      >
        ${MCP_PRESETS.map((preset) => {
          const active = preset.id === props.presetId;
          return html`
            <button
              class="btn ${active ? "primary" : "ghost"}"
              type="button"
              style="display: flex; align-items: flex-start; gap: 8px; text-align: left; padding: 10px 12px; height: auto;"
              @click=${() => props.onPresetSelect(preset)}
            >
              <span style="font-size: 18px; line-height: 1;">${preset.icon}</span>
              <span style="display: flex; flex-direction: column; gap: 2px; min-width: 0;">
                <span style="font-weight: 600;">${preset.label}</span>
                <span class="muted" style="font-size: 12px; white-space: normal;"
                  >${preset.description}</span
                >
              </span>
            </button>
          `;
        })}
      </div>
      ${selected ? renderPresetDetail(props, selected) : nothing}
    </div>
  `;
}

function renderPresetDetail(props: McpProps, preset: McpPreset) {
  const isBearer = preset.authKind === "bearer";
  const tokenLabel = preset.tokenLabel ?? t("mcpView.add.token.label");
  return html`
    <div
      style="margin-top: 14px; padding: 12px; border: 1px solid var(--border); border-radius: 6px;"
    >
      <div style="font-weight: 600; margin-bottom: 6px;">
        ${t("mcpView.add.preset.selected", { label: preset.label })}
      </div>
      <div style="display: grid; grid-template-columns: max-content 1fr; gap: 4px 12px;">
        <div class="muted">${t("mcpView.add.link.nameLabel")}</div>
        <div>
          <input
            .value=${props.draftName || preset.name}
            @input=${(e: Event) => props.onDraftNameChange((e.target as HTMLInputElement).value)}
            autocomplete="off"
            name="mcp-preset-name"
          />
        </div>
        <div class="muted">${t("mcpView.add.link.transportLabel")}</div>
        <div class="mono" style="overflow-wrap: anywhere;">${preset.transport}</div>
        <div class="muted">URL</div>
        <div class="mono" style="overflow-wrap: anywhere;">${preset.url}</div>
      </div>
      ${isBearer
        ? html`
            ${renderAuthTokenField(props, {
              label: tokenLabel,
              hint: t("mcpView.add.token.hint"),
            })}
            ${preset.tokenDocsUrl
              ? html`<div class="muted" style="font-size: 13px; margin-top: 4px;">
                  <a href=${preset.tokenDocsUrl} target="_blank" rel="noopener noreferrer"
                    >${t("mcpView.add.preset.tokenDocs")}</a
                  >
                </div>`
              : nothing}
          `
        : nothing}
      ${preset.authKind === "oauth"
        ? html`<div class="callout info" style="margin-top: 12px;">
            ${t("mcpView.add.preset.oauthNote")}
          </div>`
        : nothing}
      <div style="display: flex; gap: 8px; margin-top: 12px;">
        <button
          class="btn btn--sm primary"
          ?disabled=${props.busy || !props.connected}
          @click=${() => props.onPresetSave(preset)}
        >
          ${props.busy ? t("common.loading") : t("mcpView.add.preset.save")}
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

/** Map a special keyboard key to a CDP/puppeteer key name, or null if printable. */
function mapSpecialKey(key: string): string | null {
  switch (key) {
    case "Enter":
    case "Tab":
    case "Backspace":
    case "Delete":
    case "Escape":
    case "ArrowUp":
    case "ArrowDown":
    case "ArrowLeft":
    case "ArrowRight":
    case "Home":
    case "End":
    case "PageUp":
    case "PageDown":
      return key;
    default:
      return null;
  }
}

// Module-level pointer state: the view is stateless, so drag tracking and
// move-throttling live here.
let embeddedPointerDown = false;
let embeddedLastMoveMs = 0;

function embeddedPoint(
  ev: MouseEvent,
  viewport: { w: number; h: number },
): { x: number; y: number } {
  const target = ev.currentTarget as HTMLElement;
  const rect = target.getBoundingClientRect();
  const x = rect.width > 0 ? ((ev.clientX - rect.left) / rect.width) * viewport.w : 0;
  const y = rect.height > 0 ? ((ev.clientY - rect.top) / rect.height) * viewport.h : 0;
  return { x: Math.round(x), y: Math.round(y) };
}

function renderEmbeddedViewport(props: McpProps) {
  const flow = props.embeddedFlow!;
  const { w, h } = flow.viewport;
  const interactive = flow.phase === "interactive";
  const src = flow.frame ? `data:image/jpeg;base64,${flow.frame.dataBase64}` : null;

  const onMouseDown = (ev: MouseEvent) => {
    if (!interactive) {
      return;
    }
    ev.preventDefault();
    (ev.currentTarget as HTMLElement).focus();
    embeddedPointerDown = true;
    const p = embeddedPoint(ev, flow.viewport);
    props.onEmbeddedInput({ kind: "mouse", action: "down", x: p.x, y: p.y });
  };
  const onMouseUp = (ev: MouseEvent) => {
    if (!interactive) {
      return;
    }
    embeddedPointerDown = false;
    const p = embeddedPoint(ev, flow.viewport);
    props.onEmbeddedInput({ kind: "mouse", action: "up", x: p.x, y: p.y });
  };
  const onMouseMove = (ev: MouseEvent) => {
    if (!interactive || !embeddedPointerDown) {
      return;
    }
    const now = Date.now();
    if (now - embeddedLastMoveMs < 40) {
      return;
    }
    embeddedLastMoveMs = now;
    const p = embeddedPoint(ev, flow.viewport);
    props.onEmbeddedInput({ kind: "mouse", action: "move", x: p.x, y: p.y });
  };
  const onClick = (ev: MouseEvent) => {
    if (!interactive) {
      return;
    }
    const p = embeddedPoint(ev, flow.viewport);
    props.onEmbeddedInput({ kind: "mouse", action: "click", x: p.x, y: p.y });
  };
  const onWheel = (ev: WheelEvent) => {
    if (!interactive) {
      return;
    }
    ev.preventDefault();
    const p = embeddedPoint(ev, flow.viewport);
    props.onEmbeddedInput({
      kind: "wheel",
      x: p.x,
      y: p.y,
      deltaX: Math.round(ev.deltaX),
      deltaY: Math.round(ev.deltaY),
    });
  };
  const onKeyDown = (ev: KeyboardEvent) => {
    if (!interactive) {
      return;
    }
    const special = mapSpecialKey(ev.key);
    if (special) {
      ev.preventDefault();
      props.onEmbeddedInput({ kind: "key", action: "press", key: special });
    } else if (ev.key.length === 1 && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
      ev.preventDefault();
      props.onEmbeddedInput({ kind: "key", action: "type", text: ev.key });
    }
  };

  return html`<div class="callout info" style="margin-top: 12px;">
    <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 8px;">
      <div>
        <div style="font-weight: 600;">
          ${t("mcpView.oauth.embedded.title", { name: flow.name })}
        </div>
        <div class="muted" style="font-size: 13px;">
          ${flow.phase === "loading"
            ? t("mcpView.oauth.embedded.loading")
            : t("mcpView.oauth.embedded.subtitle")}
        </div>
      </div>
      <button class="btn btn--sm ghost" style="margin-left: auto;" @click=${props.onEmbeddedCancel}>
        ${t("mcpView.oauth.embedded.cancel")}
      </button>
    </div>
    <div
      tabindex="0"
      style="position: relative; width: 100%; max-width: ${w}px; aspect-ratio: ${w} / ${h}; margin: 0 auto; border: 1px solid var(--border); border-radius: 6px; overflow: hidden; outline: none; cursor: ${interactive
        ? "crosshair"
        : "progress"}; background: var(--surface);"
      @mousedown=${onMouseDown}
      @mouseup=${onMouseUp}
      @mousemove=${onMouseMove}
      @click=${onClick}
      @wheel=${onWheel}
      @keydown=${onKeyDown}
    >
      ${src
        ? html`<img
            src=${src}
            alt=${t("mcpView.oauth.embedded.title", { name: flow.name })}
            draggable="false"
            style="display: block; width: 100%; height: 100%; user-select: none; pointer-events: none;"
          />`
        : html`<div
            class="muted"
            style="display: flex; align-items: center; justify-content: center; height: 100%; font-size: 13px;"
          >
            ${t("mcpView.oauth.embedded.loading")}
          </div>`}
    </div>
  </div>`;
}

function renderServerRow(name: string, server: Record<string, unknown>, props: McpProps) {
  const status = props.oauthStatus[name];
  const test = props.testStatus[name];
  const declaresOauth = serverDeclaresOauth(server);
  const isOauthServer = declaresOauth || (status?.requiresAuth ?? false);
  const st = mcpStatus(status, test, isOauthServer);
  return html`
    <div class="table-row" style="${MCP_GRID}">
      <div style="display: flex; flex-direction: column; gap: 2px; min-width: 0;">
        <span style="font-family: var(--mono); color: var(--text);">${name}</span>
        <span class="muted" style="font-size: 13px; overflow: hidden; text-overflow: ellipsis;">
          ${summarizeTransport(server)}
        </span>
      </div>
      <span class="muted" style="font-family: var(--mono);">${transportKind(server)}</span>
      <span class="muted" style="font-family: var(--mono);">—</span>
      <span style="display: flex; align-items: center; gap: 8px;">
        <span class="status-dot ${st.dot}"></span>
        <span class="muted">${st.label}</span>
      </span>
      <span style="display: flex; gap: 6px; justify-content: flex-end; flex-wrap: wrap;">
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
      </span>
    </div>
  `;
}
