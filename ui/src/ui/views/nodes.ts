import { html, nothing } from "lit";
import {
  resolvePendingDeviceApprovalState,
  type DevicePairingAccessSummary,
  type PendingDeviceApprovalKind,
} from "../../../../src/shared/device-pairing-access.js";
import { t } from "../../i18n/index.ts";
import type { DeviceTokenSummary, PairedDevice, PendingDevice } from "../controllers/devices.ts";
import { formatRelativeTimestamp, formatList, formatUnknownText } from "../format.ts";
import { icons } from "../icons.ts";
import { normalizeOptionalString } from "../string-coerce.ts";
import { renderExecApprovals, resolveExecApprovalsState } from "./nodes-exec-approvals.ts";
import { resolveConfigAgents, resolveNodeTargets, type NodeTargetOption } from "./nodes-shared.ts";
export type { NodesProps } from "./nodes.types.ts";
import type { NodesProps } from "./nodes.types.ts";

const NODES_GRID = "grid-template-columns: 1fr 160px 120px 140px 56px;";

export function renderNodes(props: NodesProps) {
  const online = props.nodes.filter((n) => nodeStatus(n).label === "Online").length;
  return html`
    <div style="display: flex; flex-direction: column; gap: 20px;">
      <section class="card">
        <div
          class="row"
          style="justify-content: space-between; align-items: flex-start; gap: 16px;"
        >
          <div>
            <div class="card-title">${t("tabs.nodes")}</div>
            <div class="card-sub">
              ${props.nodes.length} ${props.nodes.length === 1 ? "node" : "nodes"} · ${online}
              online
            </div>
          </div>
          <button class="btn" ?disabled=${props.loading} @click=${props.onRefresh}>
            ${props.loading ? t("common.loading") : t("common.refresh")}
          </button>
        </div>
        ${props.nodes.length === 0
          ? html`<div class="muted" style="margin-top: 16px;">No nodes found.</div>`
          : html`
              <div class="table" style="margin-top: 16px;">
                <div class="table-head" style=${NODES_GRID}>
                  <span>NODE</span>
                  <span>PLATFORM</span>
                  <span>ROLE</span>
                  <span>STATUS</span>
                  <span></span>
                </div>
                ${props.nodes.map((node) => renderNodeRow(node, props))}
              </div>
            `}
      </section>
      ${renderDevices(props)}
    </div>
    ${renderNodeModals(props)}
  `;
}

function nodePlatform(node: Record<string, unknown>): string {
  const os = normalizeOptionalString(node.platform) ?? normalizeOptionalString(node.os);
  const arch = normalizeOptionalString(node.arch);
  if (os && arch) {
    return `${os}-${arch}`;
  }
  return os ?? arch ?? "—";
}

function nodeRole(node: Record<string, unknown>): string {
  return (
    normalizeOptionalString(node.role) ??
    normalizeOptionalString(node.kind) ??
    (node.isGateway === true ? "Gateway" : "Node")
  );
}

function nodeStatus(node: Record<string, unknown>): { dot: string; label: string } {
  const online = node.online !== false && node.connected !== false;
  return online
    ? { dot: "status-dot--ok", label: "Online" }
    : { dot: "status-dot--idle", label: "Offline" };
}

function renderNodeRow(node: Record<string, unknown>, props: NodesProps) {
  const id = getNodeId(node);
  const st = nodeStatus(node);
  return html`
    <div class="table-row" style=${NODES_GRID}>
      <div style="display: flex; flex-direction: column; gap: 2px; min-width: 0;">
        <span style="font-family: var(--mono); color: var(--text);">${getNodeTitle(node)}</span>
        <span class="muted" style="font-size: 13px; overflow: hidden; text-overflow: ellipsis;">
          ${id ?? "—"}
        </span>
      </div>
      <span class="muted" style="font-family: var(--mono);">${nodePlatform(node)}</span>
      <span class="muted" style="font-family: var(--mono);">${nodeRole(node)}</span>
      <span style="display: flex; align-items: center; gap: 8px;">
        <span class="status-dot ${st.dot}"></span>
        <span class="muted">${st.label}</span>
      </span>
      <span style="position: relative; display: flex; justify-content: flex-end;">
        <button
          class="btn btn--sm ghost"
          ?disabled=${!id}
          aria-label="Node actions"
          @click=${(event: Event) => {
            event.stopPropagation();
            if (id) {
              props.onToggleActionMenu(props.nodesActionMenuId === id ? null : id);
            }
          }}
        >
          ${icons.moreHorizontal}
        </button>
        ${id ? renderActionMenu(id, props) : nothing}
      </span>
    </div>
  `;
}

function renderActionMenu(nodeId: string, props: NodesProps) {
  if (props.nodesActionMenuId !== nodeId) {
    return nothing;
  }
  const items: Array<[string, typeof icons.refresh, () => void]> = [
    ["Update", icons.refresh, () => props.onUpdateNode(nodeId)],
    ["Permissions", icons.shield, () => props.onOpenNodeModal("permissions", nodeId)],
    ["Run command", icons.play, () => props.onOpenNodeModal("run", nodeId)],
    ["Open terminal", icons.terminal, () => props.onOpenNodeModal("terminal", nodeId)],
  ];
  return html`
    <div
      class="nodes-action-menu"
      @click=${(event: Event) => event.stopPropagation()}
      style="position: absolute; top: calc(100% + 4px); right: 0; z-index: 40; min-width: 200px; display: flex; flex-direction: column; gap: 2px; padding: 4px; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);"
    >
      ${items.map(
        ([label, icon, onClick]) => html`
          <button
            class="nodes-action-menu__item"
            @click=${onClick}
            style="display: flex; align-items: center; gap: 12px; width: 100%; padding: 8px 12px; border: none; border-radius: 6px; background: transparent; color: var(--text); font: inherit; text-align: left; cursor: pointer;"
          >
            <span style="display: inline-flex; width: 16px; height: 16px;">${icon}</span>
            <span>${label}</span>
          </button>
        `,
      )}
    </div>
  `;
}

function renderModalShell(params: {
  title: string;
  sub: string;
  onClose: () => void;
  body: unknown;
  width?: number;
}) {
  const width = params.width ?? 640;
  return html`
    <div
      class="nodes-modal-overlay"
      @click=${(event: Event) => {
        if (event.target === event.currentTarget) {
          params.onClose();
        }
      }}
      style="position: fixed; inset: 0; z-index: 60; display: flex; align-items: center; justify-content: center; padding: 24px; background: rgba(0, 0, 0, 0.6); backdrop-filter: blur(4px);"
    >
      <div
        style="width: min(${width}px, 100%); max-height: 85vh; display: flex; flex-direction: column; overflow: hidden; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; box-shadow: 0 16px 48px rgba(0, 0, 0, 0.6);"
      >
        <div
          style="display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 16px 24px; border-bottom: 1px solid var(--border);"
        >
          <div style="display: flex; flex-direction: column; gap: 4px; min-width: 0;">
            <div style="font-size: 18px; font-weight: 600; color: var(--text);">
              ${params.title}
            </div>
            <div class="muted mono" style="font-size: 12px;">${params.sub}</div>
          </div>
          <button class="btn btn--sm ghost" aria-label="Close" @click=${params.onClose}>
            ${icons.x}
          </button>
        </div>
        <div style="padding: 24px; overflow: auto;">${params.body}</div>
      </div>
    </div>
  `;
}

function renderNodeModals(props: NodesProps) {
  const modal = props.nodesModal;
  if (!modal) {
    return nothing;
  }
  const node = props.nodes.find((n) => getNodeId(n) === modal.nodeId) ?? null;
  const title = node ? getNodeTitle(node) : modal.nodeId;
  if (modal.kind === "permissions") {
    return renderModalShell({
      title: "Permissions",
      sub: title,
      width: 760,
      onClose: props.onCloseNodeModal,
      body: html`
        ${renderExecApprovals(resolveExecApprovalsState(props))}
        ${renderBindings(resolveBindingsState(props))}
      `,
    });
  }
  if (modal.kind === "terminal") {
    const commands = node ? getNodeCommands(node) : [];
    const supportsSystemRun = commands.includes("system.run");
    const busy = props.nodeManagementBusy;
    return renderModalShell({
      title: "Terminal",
      sub: title,
      onClose: props.onCloseNodeModal,
      body: html`
        <div class="list">
          ${renderNodeShellControls({ busy, supportsSystemRun, props })}
          ${renderNodeManagementResult(props)}
        </div>
      `,
    });
  }
  const commands = node ? getNodeCommands(node) : [];
  const commandOptions = commands.filter(
    (command) =>
      command !== "system.execApprovals.get" &&
      command !== "system.execApprovals.set" &&
      command !== "system.run.prepare",
  );
  const supportsSystemRun = commands.includes("system.run");
  const supportsSystemWhich = commands.includes("system.which");
  const busy = props.nodeManagementBusy;
  return renderModalShell({
    title: "Run command",
    sub: title,
    onClose: props.onCloseNodeModal,
    body: html`
      ${props.nodeManagementError
        ? html`<div class="callout danger" style="margin-bottom: 12px;">
            ${props.nodeManagementError}
          </div>`
        : nothing}
      <div class="list">
        ${node ? renderNodeRenameControls(props, node) : nothing}
        ${renderNodePresetControls({ busy, supportsSystemRun, supportsSystemWhich, props })}
        ${renderNodeCommandControls({ busy, commandOptions, props })}
        ${renderNodeManagementResult(props)}
      </div>
    `,
  });
}

function renderNodeRenameControls(props: NodesProps, node: Record<string, unknown>) {
  return html`
    <div class="list-item">
      <div class="list-main">
        <div class="list-title">Display Name</div>
        <div class="list-sub">${getNodeId(node) ?? ""}</div>
      </div>
      <div class="list-meta" style="min-width: min(420px, 100%);">
        <div class="row" style="justify-content: flex-end; gap: 8px; flex-wrap: wrap;">
          <input
            style="min-width: min(260px, 100%);"
            .value=${props.nodeManagementRename}
            ?disabled=${props.nodeManagementBusy}
            @input=${(event: Event) =>
              props.onNodeManagementRenameChange((event.target as HTMLInputElement).value)}
          />
          <button
            class="btn btn--sm"
            ?disabled=${props.nodeManagementBusy || !props.nodeManagementRename.trim()}
            @click=${props.onNodeManagementRename}
          >
            ${icons.edit} Rename
          </button>
        </div>
      </div>
    </div>
  `;
}

function renderNodePresetControls(params: {
  busy: boolean;
  supportsSystemRun: boolean;
  supportsSystemWhich: boolean;
  props: NodesProps;
}) {
  const { busy, supportsSystemRun, supportsSystemWhich, props } = params;
  return html`
    <div class="list-item">
      <div class="list-main">
        <div class="list-title">Host Operations</div>
        <div class="list-sub">Update status, update, restart, and executable discovery.</div>
      </div>
      <div class="list-meta">
        <div class="row" style="justify-content: flex-end; gap: 8px; flex-wrap: wrap;">
          ${renderPresetButton("which-genesis", "Find CLI", supportsSystemWhich, busy, props)}
          ${renderPresetButton("update-status", "Update Status", supportsSystemRun, busy, props)}
          ${renderPresetButton("update-run", "Update", supportsSystemRun, busy, props, true)}
          ${renderPresetButton(
            "restart-service",
            "Restart Node",
            supportsSystemRun,
            busy,
            props,
            true,
          )}
        </div>
      </div>
    </div>
  `;
}

function renderPresetButton(
  preset: Parameters<NodesProps["onNodeManagementPreset"]>[0],
  label: string,
  enabled: boolean,
  busy: boolean,
  props: NodesProps,
  danger = false,
) {
  return html`
    <button
      class="btn btn--sm ${danger ? "danger" : ""}"
      ?disabled=${busy || !enabled}
      @click=${() => props.onNodeManagementPreset(preset)}
    >
      ${preset === "which-genesis" ? icons.search : icons.refresh} ${label}
    </button>
  `;
}

function renderNodeShellControls(params: {
  busy: boolean;
  supportsSystemRun: boolean;
  props: NodesProps;
}) {
  const { busy, supportsSystemRun, props } = params;
  return html`
    <div class="list-item">
      <div class="list-main">
        <div class="list-title">Shell Command</div>
        <div class="list-sub">Runs through <code>system.run</code> on the selected node.</div>
      </div>
      <div class="list-meta" style="min-width: min(560px, 100%);">
        <div style="display: grid; gap: 8px;">
          <textarea
            rows="3"
            spellcheck="false"
            .value=${props.nodeManagementShell}
            ?disabled=${busy || !supportsSystemRun}
            @input=${(event: Event) =>
              props.onNodeManagementShellChange((event.target as HTMLTextAreaElement).value)}
          ></textarea>
          <div class="row" style="justify-content: flex-end; gap: 8px; flex-wrap: wrap;">
            <input
              placeholder="cwd"
              style="min-width: 180px;"
              .value=${props.nodeManagementCwd}
              ?disabled=${busy || !supportsSystemRun}
              @input=${(event: Event) =>
                props.onNodeManagementCwdChange((event.target as HTMLInputElement).value)}
            />
            <input
              placeholder="timeout ms"
              style="width: 130px;"
              inputmode="numeric"
              .value=${props.nodeManagementTimeoutMs}
              ?disabled=${busy || !supportsSystemRun}
              @input=${(event: Event) =>
                props.onNodeManagementTimeoutChange((event.target as HTMLInputElement).value)}
            />
            <button
              class="btn btn--sm primary"
              ?disabled=${busy || !supportsSystemRun || !props.nodeManagementShell.trim()}
              @click=${props.onNodeManagementRunShell}
            >
              ${icons.terminal} ${busy ? "Running" : "Run"}
            </button>
          </div>
          ${!supportsSystemRun
            ? html`<div class="muted">This node does not advertise <code>system.run</code>.</div>`
            : nothing}
        </div>
      </div>
    </div>
  `;
}

function renderNodeCommandControls(params: {
  busy: boolean;
  commandOptions: string[];
  props: NodesProps;
}) {
  const { busy, commandOptions, props } = params;
  return html`
    <div class="list-item">
      <div class="list-main">
        <div class="list-title">Direct Command</div>
        <div class="list-sub">Invokes an advertised node command with JSON params.</div>
      </div>
      <div class="list-meta" style="min-width: min(560px, 100%);">
        <div style="display: grid; gap: 8px;">
          <select
            ?disabled=${busy || commandOptions.length === 0}
            @change=${(event: Event) =>
              props.onNodeManagementCommandChange((event.target as HTMLSelectElement).value)}
          >
            ${commandOptions.map(
              (command) =>
                html`<option value=${command} ?selected=${command === props.nodeManagementCommand}>
                  ${command}
                </option>`,
            )}
          </select>
          <textarea
            rows="5"
            spellcheck="false"
            .value=${props.nodeManagementParams}
            ?disabled=${busy || commandOptions.length === 0}
            @input=${(event: Event) =>
              props.onNodeManagementParamsChange((event.target as HTMLTextAreaElement).value)}
          ></textarea>
          <div class="row" style="justify-content: flex-end; gap: 8px; flex-wrap: wrap;">
            <button
              class="btn btn--sm primary"
              ?disabled=${busy || commandOptions.length === 0 || !props.nodeManagementCommand}
              @click=${props.onNodeManagementInvoke}
            >
              ${icons.send} Invoke
            </button>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderNodeManagementResult(props: NodesProps) {
  const result = props.nodeManagementResult;
  if (!result) {
    return nothing;
  }
  const payload = formatNodeResultPayload(result.payload);
  return html`
    <div class="list-item">
      <div class="list-main">
        <div class="list-title">${result.label}</div>
        <div class="list-sub">
          ${result.nodeId} · ${result.command} · ${result.ok ? "ok" : "failed"} ·
          ${formatRelativeTimestamp(result.completedAtMs)}
        </div>
        <pre class="code-block" style="margin-top: 10px; max-height: 360px; overflow: auto;">
${payload}</pre
        >
      </div>
    </div>
  `;
}

function getNodeId(node: Record<string, unknown>): string | null {
  return normalizeOptionalString(node.nodeId) ?? null;
}

function getNodeCommands(node: Record<string, unknown>): string[] {
  const commands = Array.isArray(node.commands) ? node.commands : [];
  return Array.from(
    new Set(
      commands
        .map((command) => normalizeOptionalString(command))
        .filter((command): command is string => Boolean(command)),
    ),
  ).toSorted((left, right) => left.localeCompare(right));
}

function getNodeTitle(node: Record<string, unknown>): string {
  return (
    normalizeOptionalString(node.displayName) ?? normalizeOptionalString(node.nodeId) ?? "unknown"
  );
}

function formatNodeResultPayload(payload: unknown): string {
  if (payload && typeof payload === "object") {
    const obj = payload as Record<string, unknown>;
    const stdout = normalizeOptionalString(obj.stdout);
    const stderr = normalizeOptionalString(obj.stderr);
    const error = normalizeOptionalString(obj.error);
    const exitCode =
      typeof obj.exitCode === "number" || typeof obj.exitCode === "string"
        ? String(obj.exitCode)
        : null;
    if (stdout || stderr || error || exitCode) {
      const parts: string[] = [];
      if (exitCode) {
        parts.push(`exitCode: ${exitCode}`);
      }
      if (stdout) {
        parts.push(`stdout:\n${stdout}`);
      }
      if (stderr) {
        parts.push(`stderr:\n${stderr}`);
      }
      if (error) {
        parts.push(`error:\n${error}`);
      }
      return parts.join("\n\n");
    }
  }
  return formatUnknownText(payload, { pretty: true, fallback: "" });
}

function renderDevices(props: NodesProps) {
  const list = props.devicesList ?? { pending: [], paired: [] };
  const pending = Array.isArray(list.pending) ? list.pending : [];
  const paired = Array.isArray(list.paired) ? list.paired : [];
  const pairedByDeviceId = new Map(
    paired
      .map((device) => [normalizeOptionalString(device.deviceId), device] as const)
      .filter((entry): entry is [string, PairedDevice] => Boolean(entry[0])),
  );
  return html`
    <section class="card">
      <div class="row" style="justify-content: space-between;">
        <div>
          <div class="card-title">Devices</div>
          <div class="card-sub">Pairing requests + role tokens.</div>
        </div>
        <button class="btn" ?disabled=${props.devicesLoading} @click=${props.onDevicesRefresh}>
          ${props.devicesLoading ? t("common.loading") : t("common.refresh")}
        </button>
      </div>
      ${props.devicesError
        ? html`<div class="callout danger" style="margin-top: 12px;">${props.devicesError}</div>`
        : nothing}
      <div class="list" style="margin-top: 16px;">
        ${pending.length > 0
          ? html`
              <div class="muted" style="margin-bottom: 8px;">Pending</div>
              ${pending.map((req) =>
                renderPendingDevice(req, props, lookupPairedDevice(pairedByDeviceId, req)),
              )}
            `
          : nothing}
        ${paired.length > 0
          ? html`
              <div class="muted" style="margin-top: 12px; margin-bottom: 8px;">Paired</div>
              ${paired.map((device) => renderPairedDevice(device, props))}
            `
          : nothing}
        ${pending.length === 0 && paired.length === 0
          ? html` <div class="muted">No paired devices.</div> `
          : nothing}
      </div>
    </section>
  `;
}

function lookupPairedDevice(
  pairedByDeviceId: ReadonlyMap<string, PairedDevice>,
  request: Pick<PendingDevice, "deviceId" | "publicKey">,
): PairedDevice | undefined {
  const deviceId = normalizeOptionalString(request.deviceId);
  if (!deviceId) {
    return undefined;
  }
  const paired = pairedByDeviceId.get(deviceId);
  if (!paired) {
    return undefined;
  }
  const requestPublicKey = normalizeOptionalString(request.publicKey);
  const pairedPublicKey = normalizeOptionalString(paired.publicKey);
  if (requestPublicKey && pairedPublicKey && requestPublicKey !== pairedPublicKey) {
    return undefined;
  }
  return paired;
}

function formatAccessSummary(access: DevicePairingAccessSummary | null): string {
  if (!access) {
    return "none";
  }
  return `roles: ${formatList(access.roles)} · scopes: ${formatList(access.scopes)}`;
}

function renderPendingApprovalNote(kind: PendingDeviceApprovalKind) {
  switch (kind) {
    case "scope-upgrade":
      return "scope upgrade requires approval";
    case "role-upgrade":
      return "role upgrade requires approval";
    case "re-approval":
      return "reconnect details changed; approval required";
    case "new-pairing":
      return "new device pairing request";
  }
  const exhaustiveKind: never = kind;
  void exhaustiveKind;
  throw new Error("unsupported pending approval kind");
}

function renderPendingDevice(req: PendingDevice, props: NodesProps, paired?: PairedDevice) {
  const name = normalizeOptionalString(req.displayName) || req.deviceId;
  const age = typeof req.ts === "number" ? formatRelativeTimestamp(req.ts) : t("common.na");
  const approval = resolvePendingDeviceApprovalState(req, paired);
  const repair = req.isRepair ? " · repair" : "";
  const ip = req.remoteIp ? ` · ${req.remoteIp}` : "";
  return html`
    <div class="list-item">
      <div class="list-main">
        <div class="list-title">${name}</div>
        <div class="list-sub">${req.deviceId}${ip}</div>
        <div class="muted" style="margin-top: 6px;">
          ${renderPendingApprovalNote(approval.kind)} · requested ${age}${repair}
        </div>
        <div class="muted" style="margin-top: 6px;">
          requested: ${formatAccessSummary(approval.requested)}
        </div>
        ${approval.approved
          ? html`
              <div class="muted" style="margin-top: 6px;">
                approved now: ${formatAccessSummary(approval.approved)}
              </div>
            `
          : nothing}
      </div>
      <div class="list-meta">
        <div class="row" style="justify-content: flex-end; gap: 8px; flex-wrap: wrap;">
          <button class="btn btn--sm primary" @click=${() => props.onDeviceApprove(req.requestId)}>
            Approve
          </button>
          <button class="btn btn--sm" @click=${() => props.onDeviceReject(req.requestId)}>
            Reject
          </button>
        </div>
      </div>
    </div>
  `;
}

function renderPairedDevice(device: PairedDevice, props: NodesProps) {
  const name = normalizeOptionalString(device.displayName) || device.deviceId;
  const ip = device.remoteIp ? ` · ${device.remoteIp}` : "";
  const roles = `roles: ${formatList(device.roles)}`;
  const scopes = `scopes: ${formatList(device.scopes)}`;
  const tokens = Array.isArray(device.tokens) ? device.tokens : [];
  return html`
    <div class="list-item">
      <div class="list-main">
        <div class="list-title">${name}</div>
        <div class="list-sub">${device.deviceId}${ip}</div>
        <div class="muted" style="margin-top: 6px;">${roles} · ${scopes}</div>
        ${tokens.length === 0
          ? html` <div class="muted" style="margin-top: 6px">Tokens: none</div> `
          : html`
              <div class="muted" style="margin-top: 10px;">Tokens</div>
              <div style="display: flex; flex-direction: column; gap: 8px; margin-top: 6px;">
                ${tokens.map((token) => renderTokenRow(device.deviceId, token, props))}
              </div>
            `}
      </div>
    </div>
  `;
}

function renderTokenRow(deviceId: string, token: DeviceTokenSummary, props: NodesProps) {
  const status = token.revokedAtMs ? "revoked" : "active";
  const scopes = `scopes: ${formatList(token.scopes)}`;
  const when = formatRelativeTimestamp(
    token.rotatedAtMs ?? token.createdAtMs ?? token.lastUsedAtMs ?? null,
  );
  return html`
    <div class="row" style="justify-content: space-between; gap: 8px;">
      <div class="list-sub">${token.role} · ${status} · ${scopes} · ${when}</div>
      <div class="row" style="justify-content: flex-end; gap: 6px; flex-wrap: wrap;">
        <button
          class="btn btn--sm"
          @click=${() => props.onDeviceRotate(deviceId, token.role, token.scopes)}
        >
          Rotate
        </button>
        ${token.revokedAtMs
          ? nothing
          : html`
              <button
                class="btn btn--sm danger"
                @click=${() => props.onDeviceRevoke(deviceId, token.role)}
              >
                Revoke
              </button>
            `}
      </div>
    </div>
  `;
}

type BindingAgent = {
  id: string;
  name: string | undefined;
  index: number;
  isDefault: boolean;
  binding: string | null;
};

type BindingNode = NodeTargetOption;

type BindingState = {
  ready: boolean;
  disabled: boolean;
  configDirty: boolean;
  configLoading: boolean;
  configSaving: boolean;
  defaultBinding?: string | null;
  agents: BindingAgent[];
  nodes: BindingNode[];
  onBindDefault: (nodeId: string | null) => void;
  onBindAgent: (agentIndex: number, nodeId: string | null) => void;
  onSave: () => void;
  onLoadConfig: () => void;
  formMode: "form" | "raw";
};

function resolveBindingsState(props: NodesProps): BindingState {
  const config = props.configForm;
  const nodes = resolveExecNodes(props.nodes);
  const { defaultBinding, agents } = resolveAgentBindings(config);
  const ready = Boolean(config);
  const disabled = props.configSaving || props.configFormMode === "raw";
  return {
    ready,
    disabled,
    configDirty: props.configDirty,
    configLoading: props.configLoading,
    configSaving: props.configSaving,
    defaultBinding,
    agents,
    nodes,
    onBindDefault: props.onBindDefault,
    onBindAgent: props.onBindAgent,
    onSave: props.onSaveBindings,
    onLoadConfig: props.onLoadConfig,
    formMode: props.configFormMode,
  };
}

function renderBindings(state: BindingState) {
  const supportsBinding = state.nodes.length > 0;
  const defaultValue = state.defaultBinding ?? "";
  return html`
    <section class="card">
      <div class="row" style="justify-content: space-between; align-items: center;">
        <div>
          <div class="card-title">${t("nodes.binding.execNodeBinding")}</div>
          <div class="card-sub">${t("nodes.binding.execNodeBindingSubtitle")}</div>
        </div>
        <button
          class="btn"
          ?disabled=${state.disabled || !state.configDirty}
          @click=${state.onSave}
        >
          ${state.configSaving ? t("common.saving") : t("common.save")}
        </button>
      </div>

      ${state.formMode === "raw"
        ? html`
            <div class="callout warn" style="margin-top: 12px">
              ${t("nodes.binding.formModeHint")}
            </div>
          `
        : nothing}
      ${!state.ready
        ? html`<div class="row" style="margin-top: 12px; gap: 12px;">
            <div class="muted">${t("nodes.binding.loadConfigHint")}</div>
            <button class="btn" ?disabled=${state.configLoading} @click=${state.onLoadConfig}>
              ${state.configLoading ? t("common.loading") : t("common.loadConfig")}
            </button>
          </div>`
        : html`
            <div class="list" style="margin-top: 16px;">
              <div class="list-item">
                <div class="list-main">
                  <div class="list-title">${t("nodes.binding.defaultBinding")}</div>
                  <div class="list-sub">${t("nodes.binding.defaultBindingHint")}</div>
                </div>
                <div class="list-meta">
                  <label class="field">
                    <span>${t("nodes.binding.node")}</span>
                    <select
                      ?disabled=${state.disabled || !supportsBinding}
                      @change=${(event: Event) => {
                        const target = event.target as HTMLSelectElement;
                        const value = target.value.trim();
                        state.onBindDefault(value ? value : null);
                      }}
                    >
                      <option value="" ?selected=${defaultValue === ""}>Any node</option>
                      ${state.nodes.map(
                        (node) =>
                          html`<option value=${node.id} ?selected=${defaultValue === node.id}>
                            ${node.label}
                          </option>`,
                      )}
                    </select>
                  </label>
                  ${!supportsBinding
                    ? html` <div class="muted">No nodes with system.run available.</div> `
                    : nothing}
                </div>
              </div>

              ${state.agents.length === 0
                ? html` <div class="muted">No agents found.</div> `
                : state.agents.map((agent) => renderAgentBinding(agent, state))}
            </div>
          `}
    </section>
  `;
}

function renderAgentBinding(agent: BindingAgent, state: BindingState) {
  const bindingValue = agent.binding ?? "__default__";
  const label = agent.name?.trim() ? `${agent.name} (${agent.id})` : agent.id;
  const supportsBinding = state.nodes.length > 0;
  return html`
    <div class="list-item">
      <div class="list-main">
        <div class="list-title">${label}</div>
        <div class="list-sub">
          ${agent.isDefault ? "default agent" : "agent"} ·
          ${bindingValue === "__default__"
            ? `uses default (${state.defaultBinding ?? "any"})`
            : `override: ${agent.binding}`}
        </div>
      </div>
      <div class="list-meta">
        <label class="field">
          <span>Binding</span>
          <select
            ?disabled=${state.disabled || !supportsBinding}
            @change=${(event: Event) => {
              const target = event.target as HTMLSelectElement;
              const value = target.value.trim();
              state.onBindAgent(agent.index, value === "__default__" ? null : value);
            }}
          >
            <option value="__default__" ?selected=${bindingValue === "__default__"}>
              Use default
            </option>
            ${state.nodes.map(
              (node) =>
                html`<option value=${node.id} ?selected=${bindingValue === node.id}>
                  ${node.label}
                </option>`,
            )}
          </select>
        </label>
      </div>
    </div>
  `;
}

function resolveExecNodes(nodes: Array<Record<string, unknown>>): BindingNode[] {
  return resolveNodeTargets(nodes, ["system.run"]);
}

function resolveAgentBindings(config: Record<string, unknown> | null): {
  defaultBinding?: string | null;
  agents: BindingAgent[];
} {
  const fallbackAgent: BindingAgent = {
    id: "main",
    name: undefined,
    index: 0,
    isDefault: true,
    binding: null,
  };
  if (!config || typeof config !== "object") {
    return { defaultBinding: null, agents: [fallbackAgent] };
  }
  const tools = (config.tools ?? {}) as Record<string, unknown>;
  const exec = (tools.exec ?? {}) as Record<string, unknown>;
  const defaultBinding =
    typeof exec.node === "string" && exec.node.trim() ? exec.node.trim() : null;

  const agentsNode = (config.agents ?? {}) as Record<string, unknown>;
  if (!Array.isArray(agentsNode.list) || agentsNode.list.length === 0) {
    return { defaultBinding, agents: [fallbackAgent] };
  }

  const agents = resolveConfigAgents(config).map((entry) => {
    const toolsEntry = (entry.record.tools ?? {}) as Record<string, unknown>;
    const execEntry = (toolsEntry.exec ?? {}) as Record<string, unknown>;
    const binding =
      typeof execEntry.node === "string" && execEntry.node.trim() ? execEntry.node.trim() : null;
    return {
      id: entry.id,
      name: entry.name,
      index: entry.index,
      isDefault: entry.isDefault,
      binding,
    };
  });

  if (agents.length === 0) {
    agents.push(fallbackAgent);
  }

  return { defaultBinding, agents };
}
