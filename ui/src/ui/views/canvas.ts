import { html, nothing } from "lit";
import { resolveCanvasIframeUrl } from "../canvas-url.ts";
import { resolveEmbedSandbox, type EmbedSandboxMode } from "../embed-sandbox.ts";
import { buildExternalLinkRel, EXTERNAL_LINK_TARGET } from "../external-link.ts";
import { icons } from "../icons.ts";

const DEFAULT_CANVAS_ENTRY_URL = "/__genesis__/canvas/";

let canvasEntryDraft = DEFAULT_CANVAS_ENTRY_URL;

export type CanvasProps = {
  connected: boolean;
  canvasHostUrl?: string | null;
  embedSandboxMode?: EmbedSandboxMode;
  allowExternalEmbedUrls?: boolean;
  onNavigateToChat: () => void;
  onRequestUpdate?: () => void;
};

type AssetGroup = {
  label: string;
  formats: string;
  viewer: string;
};

const ASSET_GROUPS: readonly AssetGroup[] = [
  { label: "Presentations", formats: "PPTX, PPT", viewer: "Slides" },
  { label: "3D models", formats: "GLB, GLTF, OBJ, STL", viewer: "Three.js" },
  { label: "Vectors", formats: "SVG", viewer: "Image wrapper" },
  { label: "Sidecars", formats: "MTL, textures", viewer: "Copied assets" },
] as const;

export function resetCanvasViewForTests() {
  canvasEntryDraft = DEFAULT_CANVAS_ENTRY_URL;
}

function setCanvasEntryDraft(value: string, onRequestUpdate: (() => void) | undefined) {
  canvasEntryDraft = value;
  onRequestUpdate?.();
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

function renderOpenButton(resolvedUrl: string | undefined) {
  if (!resolvedUrl) {
    return html`
      <button class="btn" type="button" disabled>${icons.externalLink}<span>Open</span></button>
    `;
  }
  return html`
    <a class="btn" href=${resolvedUrl} rel=${buildExternalLinkRel()} target=${EXTERNAL_LINK_TARGET}>
      ${icons.externalLink}<span>Open</span>
    </a>
  `;
}

function renderAssetGroup(group: AssetGroup) {
  return html`
    <div class="canvas-format-card">
      <div class="canvas-format-title">${group.label}</div>
      <div class="canvas-format-sub">${group.formats}</div>
      <div class="canvas-format-viewer">${group.viewer}</div>
    </div>
  `;
}

export function renderCanvas(props: CanvasProps) {
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
            <div class="card-title">Canvas</div>
            <div class="card-sub">Hosted documents and rich asset previews.</div>
          </div>
          <div class="row canvas-header-actions">
            <button class="btn" type="button" @click=${props.onNavigateToChat}>
              ${icons.messageSquare}<span>Chat</span>
            </button>
          </div>
        </div>

        <div class="canvas-status-grid">
          ${renderStatusItem(
            "Gateway",
            props.connected ? "Connected" : "Disconnected",
            props.connected ? "normal" : "danger",
          )}
          ${renderStatusItem("Host", hostLabel)} ${renderStatusItem("Sandbox", sandbox || "strict")}
          ${renderStatusItem(
            "External embeds",
            props.allowExternalEmbedUrls ? "Enabled" : "Disabled",
          )}
        </div>
      </section>

      <section class="card">
        <div class="canvas-preview-toolbar">
          <label class="field canvas-entry-field">
            <span>Entry URL</span>
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
              ${icons.refresh}<span>Reset</span>
            </button>
            ${renderOpenButton(resolvedUrl)}
          </div>
        </div>

        ${invalidEntry
          ? html`
              <div class="callout danger canvas-preview-error">
                Only trusted Canvas URLs under /__genesis__/canvas or /__genesis__/a2ui can be
                embedded here.
              </div>
            `
          : nothing}
        ${resolvedUrl
          ? html`
              <iframe
                class="canvas-preview-frame"
                title="Canvas preview"
                sandbox=${sandbox}
                src=${resolvedUrl}
              ></iframe>
            `
          : html`<div class="canvas-preview-empty muted">No preview loaded.</div>`}
      </section>

      <section class="canvas-format-grid">${ASSET_GROUPS.map(renderAssetGroup)}</section>
    </div>
  `;
}
