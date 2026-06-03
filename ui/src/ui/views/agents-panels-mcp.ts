import { html, nothing } from "lit";
import { t } from "../../i18n/index.ts";
import { sortCopy } from "../array.ts";
import type { McpMessage, McpServersMap } from "../controllers/mcp.ts";

const EXAMPLE_CONFIG = `{
  "url": "https://mcp.context7.com/mcp",
  "transport": "streamable-http"
}`;

export type AgentMcpProps = {
  servers: McpServersMap | null;
  path: string | null;
  loading: boolean;
  error: string | null;
  busy: boolean;
  message: McpMessage | null;
  draftName: string;
  draftConfig: string;
  onRefresh: () => void;
  onDraftNameChange: (value: string) => void;
  onDraftConfigChange: (value: string) => void;
  onEdit: (name: string) => void;
  onSave: () => void;
  onDelete: (name: string) => void;
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

export function renderAgentMcp(props: AgentMcpProps) {
  const entries = props.servers
    ? sortCopy(Object.entries(props.servers), ([a], [b]) => a.localeCompare(b))
    : [];
  const canSave = props.draftName.trim().length > 0 && !props.busy;
  return html`
    <div class="card">
      <div style="display: flex; align-items: center; justify-content: space-between; gap: 12px;">
        <div>
          <div class="card-title">MCP Servers</div>
          <div class="card-sub">
            Manage Model Context Protocol servers available to this Genesis instance.
          </div>
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
      ${!props.servers
        ? html`<div class="callout info" style="margin-top: 12px;">
            Loading configured MCP servers…
          </div>`
        : entries.length === 0
          ? html`<div class="muted" style="margin-top: 16px;">No MCP servers configured yet.</div>`
          : html`
              <div style="margin-top: 14px; display: flex; flex-direction: column; gap: 10px;">
                ${entries.map(
                  ([name, server]) => html`
                    <div
                      class="card"
                      style="display: flex; align-items: center; justify-content: space-between; gap: 12px;"
                    >
                      <div style="min-width: 0;">
                        <div style="font-weight: 600;">${name}</div>
                        <div class="muted mono" style="overflow-wrap: anywhere;">
                          ${summarizeTransport(server)}
                        </div>
                      </div>
                      <div style="display: flex; gap: 8px; flex-shrink: 0;">
                        <button
                          class="btn btn--sm btn--ghost"
                          ?disabled=${props.busy}
                          @click=${() => props.onEdit(name)}
                        >
                          Edit
                        </button>
                        <button
                          class="btn btn--sm btn--ghost"
                          ?disabled=${props.busy}
                          @click=${() => props.onDelete(name)}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  `,
                )}
              </div>
            `}

      <div style="margin-top: 16px; border-top: 1px solid var(--border); padding-top: 16px;">
        <div style="font-weight: 600; margin-bottom: 4px;">Add or update server</div>
        <div class="muted" style="font-size: 13px; margin-bottom: 12px;">
          Provide a name and a JSON config. Use <code>url</code> + <code>transport</code> for remote
          (HTTP) servers, or <code>command</code> + <code>args</code> for local stdio servers.
        </div>
        <label class="field" style="margin-bottom: 12px;">
          <span>Name</span>
          <input
            .value=${props.draftName}
            @input=${(e: Event) => props.onDraftNameChange((e.target as HTMLInputElement).value)}
            placeholder="context7"
            autocomplete="off"
            name="mcp-server-name"
          />
        </label>
        <label class="field agent-file-field">
          <span>Config (JSON)</span>
          <textarea
            class="agent-file-textarea"
            .value=${props.draftConfig}
            @input=${(e: Event) =>
              props.onDraftConfigChange((e.target as HTMLTextAreaElement).value)}
            placeholder=${EXAMPLE_CONFIG}
            spellcheck="false"
          ></textarea>
        </label>
        <div style="display: flex; gap: 8px; margin-top: 12px;">
          <button class="btn btn--sm" ?disabled=${!canSave} @click=${props.onSave}>
            ${props.busy ? t("common.loading") : "Save server"}
          </button>
        </div>
      </div>
    </div>
  `;
}
