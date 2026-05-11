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

export function renderNodes(props: NodesProps) {
  const bindingState = resolveBindingsState(props);
  const approvalsState = resolveExecApprovalsState(props);
  return html`
    ${renderNodeInventory(props)} ${renderNodeManagement(props)}
    ${renderExecApprovals(approvalsState)} ${renderBindings(bindingState)} ${renderDevices(props)}
  `;
}

function renderNodeInventory(props: NodesProps) {
  return html` <section class="card">
    <div class="row" style="justify-content: space-between;">
      <div>
        <div class="card-title">Nodes</div>
        <div class="card-sub">Paired devices and live links.</div>
      </div>
      <button class="btn" ?disabled=${props.loading} @click=${props.onRefresh}>
        ${icons.refresh} ${props.loading ? t("common.loading") : t("common.refresh")}
      </button>
    </div>
    <div class="list" style="margin-top: 16px;">
      ${props.nodes.length === 0
        ? html` <div class="muted">No nodes found.</div> `
        : props.nodes.map((n) => renderNode(n, props))}
    </div>
  </section>`;
}

function renderNodeManagement(props: NodesProps) {
  const selected = resolveSelectedNode(props);
  const nodeId = selected ? getNodeId(selected) : props.nodeManagementSelectedId;
  const commands = selected ? getNodeCommands(selected) : [];
  const commandOptions = commands.filter(
    (command) =>
      command !== "system.execApprovals.get" &&
      command !== "system.execApprovals.set" &&
      command !== "system.run.prepare",
  );
  const supportsSystemRun = commands.includes("system.run");
  const supportsSystemWhich = commands.includes("system.which");
  const busy = props.nodeManagementBusy;
  return html`
    <section class="card">
      <div class="row" style="justify-content: space-between; align-items: center;">
        <div>
          <div class="card-title">Node Management</div>
          <div class="card-sub">Rename nodes, run advertised commands, and operate node hosts.</div>
        </div>
        <label class="field" style="min-width: min(320px, 100%);">
          <span>Node</span>
          <select
            ?disabled=${busy || props.nodes.length === 0}
            @change=${(event: Event) => {
              const target = event.target as HTMLSelectElement;
              props.onNodeManagementSelect(target.value);
            }}
          >
            ${props.nodes.map((node) => {
              const id = getNodeId(node);
              if (!id) {
                return nothing;
              }
              return html`<option value=${id} ?selected=${id === nodeId}>
                ${getNodeTitle(node)}
              </option>`;
            })}
          </select>
        </label>
      </div>

      ${props.nodeManagementError
        ? html`<div class="callout danger" style="margin-top: 12px;">
            ${props.nodeManagementError}
          </div>`
        : nothing}
      ${!selected
        ? html`<div class="muted" style="margin-top: 16px;">No node selected.</div>`
        : html`
            <div class="list" style="margin-top: 16px;">
              ${renderNodeRenameControls(props, selected)}
              ${renderNodePresetControls({
                busy,
                supportsSystemRun,
                supportsSystemWhich,
                props,
              })}
              ${renderNodeShellControls({ busy, supportsSystemRun, props })}
              ${renderNodeCommandControls({ busy, commandOptions, props })}
              ${renderNodeManagementResult(props)}
            </div>
          `}
    </section>
  `;
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

function resolveSelectedNode(props: NodesProps): Record<string, unknown> | null {
  const selectedId = normalizeOptionalString(props.nodeManagementSelectedId);
  if (!selectedId) {
    return null;
  }
  return props.nodes.find((node) => getNodeId(node) === selectedId) ?? null;
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

function renderNode(node: Record<string, unknown>, props: NodesProps) {
  const connected = Boolean(node.connected);
  const paired = Boolean(node.paired);
  const title =
    (typeof node.displayName === "string" && node.displayName.trim()) ||
    (typeof node.nodeId === "string" ? node.nodeId : "unknown");
  const nodeId = typeof node.nodeId === "string" ? node.nodeId : "";
  const selected = Boolean(nodeId && nodeId === props.nodeManagementSelectedId);
  const caps = Array.isArray(node.caps) ? (node.caps as unknown[]) : [];
  const commands = Array.isArray(node.commands) ? (node.commands as unknown[]) : [];
  return html`
    <div class="list-item">
      <div class="list-main">
        <div class="list-title">${title}</div>
        <div class="list-sub">
          ${typeof node.nodeId === "string" ? node.nodeId : ""}
          ${typeof node.remoteIp === "string" ? ` · ${node.remoteIp}` : ""}
          ${typeof node.version === "string" ? ` · ${node.version}` : ""}
        </div>
        <div class="chip-row" style="margin-top: 6px;">
          <span class="chip">${paired ? "paired" : "unpaired"}</span>
          <span class="chip ${connected ? "chip-ok" : "chip-warn"}">
            ${connected ? "connected" : "offline"}
          </span>
          ${caps.slice(0, 12).map((c) => html`<span class="chip">${String(c)}</span>`)}
          ${commands.slice(0, 8).map((c) => html`<span class="chip">${String(c)}</span>`)}
        </div>
      </div>
      <div class="list-meta">
        <button
          class="btn btn--sm ${selected ? "primary" : ""}"
          ?disabled=${!nodeId}
          @click=${() => props.onNodeManagementSelect(nodeId)}
        >
          ${icons.settings} ${selected ? "Selected" : "Manage"}
        </button>
      </div>
    </div>
  `;
}
