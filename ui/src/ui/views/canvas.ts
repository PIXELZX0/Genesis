import { html, nothing } from "lit";
import type {
  CanvasDocumentCreateParams,
  CanvasDocumentCreateResult,
  CanvasDocumentListResult,
} from "../../../../src/gateway/protocol/schema/types.js";
import { t } from "../../i18n/index.ts";
import { resolveCanvasIframeUrl } from "../canvas-url.ts";
import { loadDeviceAuthToken } from "../device-auth.ts";
import { loadOrCreateDeviceIdentity } from "../device-identity.ts";
import { resolveEmbedSandbox, type EmbedSandboxMode } from "../embed-sandbox.ts";
import { buildExternalLinkRel, EXTERNAL_LINK_TARGET } from "../external-link.ts";
import { CONTROL_UI_OPERATOR_ROLE, type GatewayBrowserClient } from "../gateway.ts";
import { icons } from "../icons.ts";

const DEFAULT_CANVAS_ENTRY_URL = "/__genesis__/canvas/";
const CANVAS_UPLOAD_PATH = "/__genesis__/canvas-upload";
const DEFAULT_INLINE_HTML = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Canvas</title>
    <style>
      body { font-family: system-ui, sans-serif; margin: 32px; }
    </style>
  </head>
  <body>
    <h1>Canvas</h1>
  </body>
</html>`;

let canvasEntryDraft = DEFAULT_CANVAS_ENTRY_URL;
let canvasSourceMode: CanvasSourceMode = "file";
let canvasTitleDraft = "";
let canvasDocumentIdDraft = "";
let canvasPreferredHeightDraft = "560";
let canvasKindDraft = "";
let canvasHtmlDraft = DEFAULT_INLINE_HTML;
let canvasUrlDraft = "";
let canvasPathDraft = "";
let canvasSelectedFile: File | null = null;
let canvasDocuments: CanvasDocument[] = [];
let canvasDocumentsLoading = false;
let canvasDocumentsLoaded = false;
let canvasDocumentsClient: GatewayBrowserClient | null = null;
let canvasBusy = false;
let canvasStatusMessage: CanvasMessage | null = null;
let canvasListRequestSerial = 0;

export type CanvasProps = {
  connected: boolean;
  client?: GatewayBrowserClient | null;
  gatewayUrl?: string | null;
  authToken?: string | null;
  password?: string | null;
  basePath?: string;
  canvasHostUrl?: string | null;
  embedSandboxMode?: EmbedSandboxMode;
  allowExternalEmbedUrls?: boolean;
  onNavigateToChat: () => void;
  onRequestUpdate?: () => void;
};

type CanvasDocument = CanvasDocumentCreateResult;
type CanvasSourceMode = "file" | "html" | "url" | "path";
type CanvasMutationMode = "create" | "update";
type CanvasMessage = { tone: "success" | "danger" | "normal"; text: string };

const SOURCE_MODES: ReadonlyArray<{ mode: CanvasSourceMode; labelKey: string }> = [
  { mode: "file", labelKey: "canvasView.source.file" },
  { mode: "html", labelKey: "canvasView.source.html" },
  { mode: "url", labelKey: "canvasView.source.url" },
  { mode: "path", labelKey: "canvasView.source.path" },
] as const;

const CANVAS_KINDS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "", label: "Auto" },
  { value: "html_bundle", label: "HTML bundle" },
  { value: "url_embed", label: "URL embed" },
  { value: "document", label: "Document" },
  { value: "image", label: "Image" },
  { value: "video_asset", label: "Video" },
  { value: "presentation_asset", label: "Presentation" },
  { value: "model_3d", label: "3D model" },
  { value: "vector_image", label: "Vector image" },
] as const;

export function resetCanvasViewForTests() {
  canvasEntryDraft = DEFAULT_CANVAS_ENTRY_URL;
  canvasSourceMode = "file";
  canvasTitleDraft = "";
  canvasDocumentIdDraft = "";
  canvasPreferredHeightDraft = "560";
  canvasKindDraft = "";
  canvasHtmlDraft = DEFAULT_INLINE_HTML;
  canvasUrlDraft = "";
  canvasPathDraft = "";
  canvasSelectedFile = null;
  canvasDocuments = [];
  canvasDocumentsLoading = false;
  canvasDocumentsLoaded = false;
  canvasDocumentsClient = null;
  canvasBusy = false;
  canvasStatusMessage = null;
  canvasListRequestSerial = 0;
}

function setCanvasEntryDraft(value: string, onRequestUpdate: (() => void) | undefined) {
  canvasEntryDraft = value;
  onRequestUpdate?.();
}

function requestCanvasUpdate(props: CanvasProps) {
  props.onRequestUpdate?.();
}

function setCanvasStatus(message: CanvasMessage | null, props: CanvasProps) {
  canvasStatusMessage = message;
  requestCanvasUpdate(props);
}

function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function normalizeControlUiBasePath(value: string | undefined): string {
  const raw = value?.trim() ?? "";
  if (!raw || raw === "/") {
    return "";
  }
  return `/${raw.replace(/^\/+|\/+$/g, "")}`;
}

function resolveCanvasUploadBaseUrl(props: CanvasProps): string {
  const fallbackBasePath = normalizeControlUiBasePath(props.basePath);
  const gatewayUrl = props.gatewayUrl?.trim();
  if (!gatewayUrl) {
    return `${fallbackBasePath}${CANVAS_UPLOAD_PATH}`;
  }
  try {
    const parsed = new URL(gatewayUrl, window.location.href);
    if (parsed.protocol === "ws:") {
      parsed.protocol = "http:";
    } else if (parsed.protocol === "wss:") {
      parsed.protocol = "https:";
    }
    const gatewayBasePath = normalizeControlUiBasePath(parsed.pathname);
    return `${parsed.origin}${gatewayBasePath || fallbackBasePath}${CANVAS_UPLOAD_PATH}`;
  } catch {
    return `${fallbackBasePath}${CANVAS_UPLOAD_PATH}`;
  }
}

async function resolveCanvasUploadAuthToken(props: CanvasProps): Promise<string | undefined> {
  const explicitToken = props.authToken?.trim() || props.password?.trim();
  if (explicitToken) {
    return explicitToken;
  }
  if (typeof crypto === "undefined" || !crypto.subtle) {
    return undefined;
  }
  try {
    const identity = await loadOrCreateDeviceIdentity();
    const stored = loadDeviceAuthToken({
      deviceId: identity.deviceId,
      role: CONTROL_UI_OPERATOR_ROLE,
    });
    const scopes = stored?.scopes ?? [];
    if (stored?.token && (scopes.includes("operator.write") || scopes.includes("operator.admin"))) {
      return stored.token;
    }
  } catch {
    // Best-effort device-token reuse. The server still enforces authorization.
  }
  return undefined;
}

function currentSourceReady(): boolean {
  if (canvasSourceMode === "file") {
    return canvasSelectedFile !== null;
  }
  if (canvasSourceMode === "html") {
    return canvasHtmlDraft.trim().length > 0;
  }
  if (canvasSourceMode === "url") {
    return canvasUrlDraft.trim().length > 0;
  }
  return canvasPathDraft.trim().length > 0;
}

function parsePreferredHeight(): number | undefined {
  const parsed = Number(canvasPreferredHeightDraft);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function applyCanvasDocument(document: CanvasDocument, props: CanvasProps) {
  canvasDocumentIdDraft = document.id;
  canvasEntryDraft = document.entryUrl;
  canvasTitleDraft = document.title ?? canvasTitleDraft;
  canvasPreferredHeightDraft =
    typeof document.preferredHeight === "number"
      ? String(document.preferredHeight)
      : canvasPreferredHeightDraft;
  canvasKindDraft = document.kind ?? canvasKindDraft;
  canvasStatusMessage = {
    tone: "success",
    text: t("canvasView.status.saved", { id: document.id }),
  };
  requestCanvasUpdate(props);
}

async function refreshCanvasDocuments(props: CanvasProps) {
  if (!props.connected || !props.client || canvasDocumentsLoading) {
    return;
  }
  const serial = ++canvasListRequestSerial;
  canvasDocumentsLoading = true;
  canvasDocumentsClient = props.client;
  requestCanvasUpdate(props);
  try {
    const result = await props.client.request<CanvasDocumentListResult>("canvas.document.list", {
      limit: 50,
    });
    if (serial === canvasListRequestSerial) {
      canvasDocuments = result.documents ?? [];
      canvasDocumentsLoaded = true;
    }
  } catch (err) {
    if (serial === canvasListRequestSerial) {
      canvasStatusMessage = {
        tone: "danger",
        text: toErrorMessage(err),
      };
    }
  } finally {
    if (serial === canvasListRequestSerial) {
      canvasDocumentsLoading = false;
      requestCanvasUpdate(props);
    }
  }
}

function ensureCanvasDocumentsLoaded(props: CanvasProps) {
  if (props.client !== canvasDocumentsClient) {
    canvasDocumentsLoaded = false;
    canvasDocumentsClient = props.client ?? null;
  }
  if (!canvasDocumentsLoaded && !canvasDocumentsLoading && props.connected && props.client) {
    void refreshCanvasDocuments(props);
  }
}

function buildRpcCanvasParams(mode: CanvasMutationMode): CanvasDocumentCreateParams {
  const params: CanvasDocumentCreateParams = {};
  const id = canvasDocumentIdDraft.trim();
  if (id) {
    params.id = id;
  }
  if (mode === "update") {
    params.id = id;
  }
  const title = canvasTitleDraft.trim();
  if (title) {
    params.title = title;
  }
  const preferredHeight = parsePreferredHeight();
  if (typeof preferredHeight === "number") {
    params.preferredHeight = preferredHeight;
  }
  if (canvasKindDraft) {
    params.kind = canvasKindDraft;
  }
  if (canvasSourceMode === "html") {
    params.html = canvasHtmlDraft;
  } else if (canvasSourceMode === "url") {
    params.url = canvasUrlDraft.trim();
  } else if (canvasSourceMode === "path") {
    params.path = canvasPathDraft.trim();
  }
  return params;
}

async function saveCanvasViaRpc(props: CanvasProps, mode: CanvasMutationMode) {
  if (!props.client) {
    throw new Error(t("canvasView.errors.notConnected"));
  }
  const params = buildRpcCanvasParams(mode);
  const method = mode === "update" ? "canvas.document.update" : "canvas.document.create";
  return await props.client.request<CanvasDocument>(method, params);
}

async function saveCanvasViaUpload(props: CanvasProps, mode: CanvasMutationMode) {
  if (!canvasSelectedFile) {
    throw new Error(t("canvasView.errors.fileRequired"));
  }
  const url = new URL(resolveCanvasUploadBaseUrl(props), window.location.href);
  url.searchParams.set("mode", mode);
  const id = canvasDocumentIdDraft.trim();
  if (id) {
    url.searchParams.set("id", id);
  }
  const title = canvasTitleDraft.trim();
  if (title) {
    url.searchParams.set("title", title);
  }
  const preferredHeight = parsePreferredHeight();
  if (typeof preferredHeight === "number") {
    url.searchParams.set("preferredHeight", String(preferredHeight));
  }
  if (canvasKindDraft) {
    url.searchParams.set("kind", canvasKindDraft);
  }

  const headers = new Headers();
  headers.set("X-Genesis-File-Name", encodeURIComponent(canvasSelectedFile.name));
  if (canvasSelectedFile.type) {
    headers.set("Content-Type", canvasSelectedFile.type);
  }
  const authToken = await resolveCanvasUploadAuthToken(props);
  if (authToken) {
    headers.set("Authorization", `Bearer ${authToken}`);
  }

  const response = await fetch(url.toString(), {
    method: "POST",
    headers,
    body: canvasSelectedFile,
  });
  const payload = (await response.json().catch(() => null)) as {
    ok?: boolean;
    document?: CanvasDocument;
    error?: { message?: string };
  } | null;
  if (!response.ok || !payload?.ok || !payload.document) {
    throw new Error(payload?.error?.message ?? response.statusText);
  }
  return payload.document;
}

async function saveCanvasDocument(props: CanvasProps, mode: CanvasMutationMode) {
  if (!props.connected) {
    setCanvasStatus({ tone: "danger", text: t("canvasView.errors.notConnected") }, props);
    return;
  }
  if (!currentSourceReady()) {
    setCanvasStatus({ tone: "danger", text: t("canvasView.errors.sourceRequired") }, props);
    return;
  }
  if (mode === "update" && !canvasDocumentIdDraft.trim()) {
    setCanvasStatus({ tone: "danger", text: t("canvasView.errors.idRequired") }, props);
    return;
  }
  canvasBusy = true;
  canvasStatusMessage = { tone: "normal", text: t("canvasView.status.saving") };
  requestCanvasUpdate(props);
  try {
    const document =
      canvasSourceMode === "file"
        ? await saveCanvasViaUpload(props, mode)
        : await saveCanvasViaRpc(props, mode);
    applyCanvasDocument(document, props);
    canvasDocumentsLoaded = false;
    void refreshCanvasDocuments(props);
  } catch (err) {
    setCanvasStatus({ tone: "danger", text: toErrorMessage(err) }, props);
  } finally {
    canvasBusy = false;
    requestCanvasUpdate(props);
  }
}

function selectCanvasDocument(document: CanvasDocument, props: CanvasProps) {
  canvasDocumentIdDraft = document.id;
  canvasTitleDraft = document.title ?? "";
  canvasPreferredHeightDraft =
    typeof document.preferredHeight === "number" ? String(document.preferredHeight) : "560";
  canvasKindDraft = document.kind ?? "";
  canvasEntryDraft = document.entryUrl;
  canvasStatusMessage = {
    tone: "normal",
    text: t("canvasView.status.selected", { id: document.id }),
  };
  requestCanvasUpdate(props);
}

function renderSourceModeButton(props: CanvasProps, item: (typeof SOURCE_MODES)[number]) {
  return html`
    <button
      class="btn canvas-source-tab ${canvasSourceMode === item.mode ? "active" : ""}"
      type="button"
      @click=${() => {
        canvasSourceMode = item.mode;
        requestCanvasUpdate(props);
      }}
    >
      ${t(item.labelKey)}
    </button>
  `;
}

function renderStatusItem(label: string, value: string, tone: "normal" | "danger" = "normal") {
  return html`
    <div class="canvas-status-item">
      <div class="canvas-status-label">${label}</div>
      <div class="canvas-status-value ${tone === "danger" ? "is-danger" : ""}" title=${value}>
        ${value}
      </div>
    </div>
  `;
}

function renderOpenButton(resolvedUrl: string | undefined, label = t("canvasView.actions.open")) {
  if (!resolvedUrl) {
    return html`
      <button class="btn" type="button" disabled>${icons.externalLink}<span>${label}</span></button>
    `;
  }
  return html`
    <a class="btn" href=${resolvedUrl} rel=${buildExternalLinkRel()} target=${EXTERNAL_LINK_TARGET}>
      ${icons.externalLink}<span>${label}</span>
    </a>
  `;
}

function renderSourceFields(props: CanvasProps) {
  if (canvasSourceMode === "file") {
    return html`
      <label class="field full canvas-file-field">
        <span>${t("canvasView.fields.file")}</span>
        <input
          type="file"
          @change=${(event: Event) => {
            const input = event.currentTarget as HTMLInputElement;
            canvasSelectedFile = input.files?.[0] ?? null;
            if (canvasSelectedFile && !canvasTitleDraft.trim()) {
              canvasTitleDraft = canvasSelectedFile.name.replace(/\.[^.]+$/, "");
            }
            requestCanvasUpdate(props);
          }}
        />
      </label>
      ${canvasSelectedFile
        ? html`
            <div class="canvas-file-selected full">
              <span>${canvasSelectedFile.name}</span>
              <span>${Math.ceil(canvasSelectedFile.size / 1024)} KB</span>
            </div>
          `
        : nothing}
    `;
  }
  if (canvasSourceMode === "html") {
    return html`
      <label class="field full">
        <span>${t("canvasView.fields.html")}</span>
        <textarea
          class="canvas-source-textarea"
          spellcheck="false"
          .value=${canvasHtmlDraft}
          @input=${(event: Event) => {
            canvasHtmlDraft = (event.currentTarget as HTMLTextAreaElement).value;
            requestCanvasUpdate(props);
          }}
        ></textarea>
      </label>
    `;
  }
  if (canvasSourceMode === "url") {
    return html`
      <label class="field full">
        <span>${t("canvasView.fields.url")}</span>
        <input
          autocomplete="off"
          spellcheck="false"
          type="url"
          .value=${canvasUrlDraft}
          @input=${(event: Event) => {
            canvasUrlDraft = (event.currentTarget as HTMLInputElement).value;
            requestCanvasUpdate(props);
          }}
          placeholder="https://example.com/document.pdf"
        />
      </label>
    `;
  }
  return html`
    <label class="field full">
      <span>${t("canvasView.fields.path")}</span>
      <input
        autocomplete="off"
        spellcheck="false"
        type="text"
        .value=${canvasPathDraft}
        @input=${(event: Event) => {
          canvasPathDraft = (event.currentTarget as HTMLInputElement).value;
          requestCanvasUpdate(props);
        }}
        placeholder="/Users/me/Documents/report.pdf"
      />
    </label>
  `;
}

function renderCanvasMessage() {
  if (!canvasStatusMessage) {
    return nothing;
  }
  const className =
    canvasStatusMessage.tone === "danger"
      ? "callout danger canvas-workspace-message"
      : "callout canvas-workspace-message";
  return html` <div class=${className}>${canvasStatusMessage.text}</div> `;
}

function renderRecentDocuments(props: CanvasProps) {
  if (canvasDocumentsLoading && canvasDocuments.length === 0) {
    return html`<div class="canvas-empty-list muted">${t("canvasView.status.loading")}</div>`;
  }
  if (canvasDocuments.length === 0) {
    return html`<div class="canvas-empty-list muted">${t("canvasView.status.noDocuments")}</div>`;
  }
  return html`
    <div class="canvas-document-list">
      ${canvasDocuments.map((document) => {
        const active = document.id === canvasDocumentIdDraft;
        const updatedAt = document.updatedAt ?? document.createdAt;
        return html`
          <button
            class="canvas-document-row ${active ? "active" : ""}"
            type="button"
            @click=${() => selectCanvasDocument(document, props)}
          >
            <span class="canvas-document-title"
              >${document.title ?? document.sourceFileName ?? document.id}</span
            >
            <span class="canvas-document-meta">
              ${document.kind} · r${document.revision} · ${updatedAt}
            </span>
          </button>
        `;
      })}
    </div>
  `;
}

function renderWorkspace(props: CanvasProps) {
  const canMutate = props.connected && !canvasBusy && currentSourceReady();
  const canUpdate = canMutate && canvasDocumentIdDraft.trim().length > 0;
  return html`
    <section class="card canvas-workspace-card">
      <div class="canvas-workspace-layout">
        <div class="canvas-editor-panel">
          <div class="canvas-panel-heading">
            <div>
              <div class="card-title">${t("canvasView.workspaceTitle")}</div>
              <div class="card-sub">${t("canvasView.workspaceSubtitle")}</div>
            </div>
          </div>

          <div class="canvas-source-tabs">
            ${SOURCE_MODES.map((item) => renderSourceModeButton(props, item))}
          </div>

          <div class="form-grid canvas-document-form">
            ${renderSourceFields(props)}

            <label class="field">
              <span>${t("canvasView.fields.title")}</span>
              <input
                autocomplete="off"
                type="text"
                .value=${canvasTitleDraft}
                @input=${(event: Event) => {
                  canvasTitleDraft = (event.currentTarget as HTMLInputElement).value;
                  requestCanvasUpdate(props);
                }}
              />
            </label>

            <label class="field">
              <span>${t("canvasView.fields.id")}</span>
              <input
                autocomplete="off"
                spellcheck="false"
                type="text"
                .value=${canvasDocumentIdDraft}
                @input=${(event: Event) => {
                  canvasDocumentIdDraft = (event.currentTarget as HTMLInputElement).value;
                  requestCanvasUpdate(props);
                }}
              />
            </label>

            <label class="field">
              <span>${t("canvasView.fields.height")}</span>
              <input
                min="120"
                step="20"
                type="number"
                .value=${canvasPreferredHeightDraft}
                @input=${(event: Event) => {
                  canvasPreferredHeightDraft = (event.currentTarget as HTMLInputElement).value;
                  requestCanvasUpdate(props);
                }}
              />
            </label>

            <label class="field">
              <span>${t("canvasView.fields.kind")}</span>
              <select
                .value=${canvasKindDraft}
                @change=${(event: Event) => {
                  canvasKindDraft = (event.currentTarget as HTMLSelectElement).value;
                  requestCanvasUpdate(props);
                }}
              >
                ${CANVAS_KINDS.map(
                  (kind) => html`<option value=${kind.value}>${kind.label}</option>`,
                )}
              </select>
            </label>
          </div>

          <div class="row canvas-mutation-actions">
            <button
              class="btn primary canvas-create-button"
              type="button"
              ?disabled=${!canMutate}
              @click=${() => void saveCanvasDocument(props, "create")}
            >
              ${icons.plus}<span
                >${canvasBusy ? t("common.saving") : t("canvasView.actions.create")}</span
              >
            </button>
            <button
              class="btn canvas-update-button"
              type="button"
              ?disabled=${!canUpdate}
              @click=${() => void saveCanvasDocument(props, "update")}
            >
              ${icons.refresh}<span>${t("canvasView.actions.update")}</span>
            </button>
          </div>
          ${renderCanvasMessage()}
        </div>

        <aside class="canvas-recent-panel">
          <div class="canvas-panel-heading canvas-recent-heading">
            <div>
              <div class="card-title">${t("canvasView.recentTitle")}</div>
              <div class="card-sub">${t("canvasView.recentSubtitle")}</div>
            </div>
            <button
              class="btn btn--icon"
              type="button"
              title=${t("common.refresh")}
              ?disabled=${!props.connected || canvasDocumentsLoading}
              @click=${() => void refreshCanvasDocuments(props)}
            >
              ${icons.refresh}
            </button>
          </div>
          ${renderRecentDocuments(props)}
        </aside>
      </div>
    </section>
  `;
}

export function renderCanvas(props: CanvasProps) {
  ensureCanvasDocumentsLoaded(props);
  const entryUrl = canvasEntryDraft.trim();
  const resolvedUrl = resolveCanvasIframeUrl(
    entryUrl,
    props.canvasHostUrl,
    props.allowExternalEmbedUrls ?? false,
  );
  const sandbox = resolveEmbedSandbox(props.embedSandboxMode ?? "scripts");
  const hostLabel = props.canvasHostUrl?.trim() || "same-origin /__genesis__/canvas";
  const invalidEntry = entryUrl.length > 0 && !resolvedUrl;

  return html`
    <div class="canvas-page">
      <section class="card">
        <div class="row canvas-header">
          <div>
            <div class="card-title">${t("tabs.canvas")}</div>
            <div class="card-sub">${t("subtitles.canvas")}</div>
          </div>
          <div class="row canvas-header-actions">
            <button class="btn" type="button" @click=${props.onNavigateToChat}>
              ${icons.messageSquare}<span>${t("tabs.chat")}</span>
            </button>
          </div>
        </div>

        <div class="canvas-status-grid">
          ${renderStatusItem(
            t("canvasView.status.gateway"),
            props.connected ? t("common.connected") : t("common.offline"),
            props.connected ? "normal" : "danger",
          )}
          ${renderStatusItem(t("canvasView.status.host"), hostLabel)}
          ${renderStatusItem(t("canvasView.status.sandbox"), sandbox || "strict")}
          ${renderStatusItem(
            t("canvasView.status.externalEmbeds"),
            props.allowExternalEmbedUrls ? t("common.enabled") : t("common.disabled"),
          )}
        </div>
      </section>

      ${renderWorkspace(props)}

      <section class="card">
        <div class="canvas-preview-toolbar">
          <label class="field canvas-entry-field">
            <span>${t("canvasView.fields.entryUrl")}</span>
            <input
              autocomplete="off"
              spellcheck="false"
              type="text"
              .value=${canvasEntryDraft}
              @input=${(event: Event) =>
                setCanvasEntryDraft(
                  (event.currentTarget as HTMLInputElement).value,
                  props.onRequestUpdate,
                )}
              placeholder="/__genesis__/canvas/documents/<id>/index.html"
            />
          </label>
          <div class="row canvas-preview-actions">
            <button
              class="btn"
              type="button"
              @click=${() => setCanvasEntryDraft(DEFAULT_CANVAS_ENTRY_URL, props.onRequestUpdate)}
            >
              ${icons.refresh}<span>${t("canvasView.actions.reset")}</span>
            </button>
            ${renderOpenButton(resolvedUrl)}
          </div>
        </div>

        ${invalidEntry
          ? html`
              <div class="callout danger canvas-preview-error">
                ${t("canvasView.errors.untrustedUrl")}
              </div>
            `
          : nothing}
        ${resolvedUrl
          ? html`
              <iframe
                class="canvas-preview-frame"
                title=${t("canvasView.previewTitle")}
                sandbox=${sandbox}
                src=${resolvedUrl}
              ></iframe>
            `
          : html`<div class="canvas-preview-empty muted">${t("canvasView.status.noPreview")}</div>`}
      </section>
    </div>
  `;
}
