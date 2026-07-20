import { html, nothing } from "lit";
import { t } from "../../i18n/index.ts";
import { formatRelativeTimestamp } from "../format.ts";
import type { FilesListResult, FilesReadResult } from "../types.ts";

function formatSize(size: number | undefined): string {
  if (size === undefined) {
    return "";
  }
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

// Split on both separators so Windows gateway paths still produce crumbs.
function breadcrumbs(path: string): { label: string; path: string }[] {
  const segments = path.split(/[\\/]/).filter(Boolean);
  const crumbs: { label: string; path: string }[] = [{ label: "/", path: "/" }];
  let current = "";
  for (const segment of segments) {
    current += `/${segment}`;
    crumbs.push({ label: segment, path: current });
  }
  return crumbs;
}

function joinPath(dir: string, name: string): string {
  return dir.endsWith("/") ? `${dir}${name}` : `${dir}/${name}`;
}

export function renderFiles(params: {
  connected: boolean;
  path: string;
  list: FilesListResult | null;
  loading: boolean;
  error: string | null;
  active: FilesReadResult | null;
  draft: string;
  saving: boolean;
  onNavigate: (path: string) => void;
  onOpenFile: (path: string) => void;
  onCloseFile: () => void;
  onDraftChange: (content: string) => void;
  onSave: () => void;
  onDelete: (path: string, isDir: boolean) => void;
  onRename: (path: string) => void;
  onMkdir: () => void;
  onUpload: (file: File) => void;
  onDownload: (path: string, name: string) => void;
}) {
  const entries = params.list?.entries ?? [];
  const active = params.active;
  const isDirty = active ? params.draft !== active.content : false;

  return html`
    <section class="card">
      <div class="row" style="justify-content: space-between;">
        <div>
          <div class="card-title">${t("tabs.files")}</div>
          <div class="card-sub">${t("subtitles.files")}</div>
        </div>
        <div class="row" style="gap: 8px;">
          <label class="btn btn--sm" style="cursor: pointer;">
            Upload
            <input
              type="file"
              style="display: none;"
              @change=${(e: Event) => {
                const input = e.target as HTMLInputElement;
                const file = input.files?.[0];
                if (file) {
                  params.onUpload(file);
                }
                input.value = "";
              }}
            />
          </label>
          <button class="btn btn--sm" @click=${params.onMkdir}>New Folder</button>
          <button
            class="btn btn--sm"
            ?disabled=${params.loading}
            @click=${() => params.onNavigate(params.path)}
          >
            ${params.loading ? t("common.loading") : t("common.refresh")}
          </button>
        </div>
      </div>
      <div class="row" style="margin-top: 12px; flex-wrap: wrap; gap: 2px;">
        ${breadcrumbs(params.path).map(
          (crumb, index, all) => html`
            ${index > 0 && index < all.length ? html`<span class="muted">/</span>` : nothing}
            <button class="btn btn--sm" @click=${() => params.onNavigate(crumb.path)}>
              ${crumb.label}
            </button>
          `,
        )}
      </div>
      ${params.error
        ? html`<div class="callout danger" style="margin-top: 12px;">${params.error}</div>`
        : nothing}
      ${active
        ? html`
            <div class="row" style="justify-content: space-between; margin-top: 14px;">
              <div class="mono">${active.path}</div>
              <div class="row" style="gap: 8px;">
                <button
                  class="btn btn--sm"
                  ?disabled=${!isDirty}
                  @click=${() => params.onDraftChange(active.content)}
                >
                  Reset
                </button>
                <button
                  class="btn btn--sm primary"
                  ?disabled=${params.saving || !isDirty}
                  @click=${params.onSave}
                >
                  ${params.saving ? "Saving…" : "Save"}
                </button>
                <button class="btn btn--sm" @click=${params.onCloseFile}>Close</button>
              </div>
            </div>
            <label class="field agent-file-field" style="margin-top: 12px;">
              <span class="mono">${formatSize(active.size)}</span>
              <textarea
                class="agent-file-textarea"
                .value=${params.draft}
                @input=${(e: Event) =>
                  params.onDraftChange((e.target as HTMLTextAreaElement).value)}
              ></textarea>
            </label>
          `
        : entries.length === 0
          ? html` <div class="muted" style="margin-top: 16px">
              ${params.loading ? t("common.loading") : "Empty directory."}
            </div>`
          : html`
              <div class="list" style="margin-top: 16px;">
                ${entries.map((entry) => {
                  const entryPath = joinPath(params.path, entry.name);
                  const isDir = entry.type === "dir";
                  return html`
                    <div class="list-item">
                      <div class="list-main">
                        <button
                          type="button"
                          class="workspace-link mono"
                          @click=${() =>
                            isDir ? params.onNavigate(entryPath) : params.onOpenFile(entryPath)}
                        >
                          ${isDir ? "📁" : "📄"} ${entry.name}
                        </button>
                        <div class="list-sub">
                          ${entry.type}${entry.mtimeMs
                            ? html` · ${formatRelativeTimestamp(entry.mtimeMs)}`
                            : nothing}
                        </div>
                      </div>
                      <div class="list-meta">
                        <div class="mono">${formatSize(entry.size)}</div>
                        <div class="row" style="gap: 6px;">
                          ${!isDir
                            ? html`
                                <button
                                  class="btn btn--sm"
                                  @click=${() => params.onDownload(entryPath, entry.name)}
                                >
                                  Download
                                </button>
                              `
                            : nothing}
                          <button class="btn btn--sm" @click=${() => params.onRename(entryPath)}>
                            Rename
                          </button>
                          <button
                            class="btn btn--sm"
                            @click=${() => params.onDelete(entryPath, isDir)}
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    </div>
                  `;
                })}
              </div>
            `}
    </section>
  `;
}
