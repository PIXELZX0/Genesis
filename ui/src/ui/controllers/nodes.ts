import type { GatewayBrowserClient } from "../gateway.ts";

export type NodeInvokeResponse = {
  ok?: boolean;
  nodeId?: string;
  command?: string;
  payload?: unknown;
  payloadJSON?: string | null;
};

export type NodeManagementPreset =
  | "update-status"
  | "update-run"
  | "restart-service"
  | "which-genesis";

export type NodeManagementResult = {
  label: string;
  nodeId: string;
  command: string;
  ok: boolean;
  payload: unknown;
  completedAtMs: number;
};

export type NodesState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  nodesLoading: boolean;
  nodes: Array<Record<string, unknown>>;
  lastError: string | null;
  nodeManagementSelectedId: string | null;
  nodeManagementRename: string;
  nodeManagementCommand: string;
  nodeManagementParams: string;
  nodeManagementShell: string;
  nodeManagementCwd: string;
  nodeManagementTimeoutMs: string;
  nodeManagementBusy: boolean;
  nodeManagementError: string | null;
  nodeManagementResult: NodeManagementResult | null;
};

function normalizeOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function getNodeId(node: Record<string, unknown>): string | null {
  return normalizeOptionalString(node.nodeId);
}

function getNodeDisplayName(node: Record<string, unknown>): string {
  return normalizeOptionalString(node.displayName) ?? getNodeId(node) ?? "";
}

function getNodeCommands(node: Record<string, unknown> | null | undefined): string[] {
  const commands = Array.isArray(node?.commands) ? node.commands : [];
  return Array.from(
    new Set(
      commands
        .map((command) => normalizeOptionalString(command))
        .filter((command): command is string => Boolean(command)),
    ),
  ).toSorted((left, right) => left.localeCompare(right));
}

function findNodeById(
  nodes: Array<Record<string, unknown>>,
  nodeId: string | null | undefined,
): Record<string, unknown> | null {
  const id = normalizeOptionalString(nodeId);
  if (!id) {
    return null;
  }
  return nodes.find((node) => getNodeId(node) === id) ?? null;
}

function firstRunnableCommand(node: Record<string, unknown> | null): string {
  return (
    getNodeCommands(node).find(
      (command) =>
        command !== "system.execApprovals.get" &&
        command !== "system.execApprovals.set" &&
        command !== "system.run.prepare",
    ) ?? ""
  );
}

function syncNodeManagementSelection(state: NodesState) {
  const selected = findNodeById(state.nodes, state.nodeManagementSelectedId);
  if (selected) {
    const commands = getNodeCommands(selected);
    if (!state.nodeManagementCommand || !commands.includes(state.nodeManagementCommand)) {
      state.nodeManagementCommand = firstRunnableCommand(selected);
      state.nodeManagementParams = defaultParamsForCommand(state.nodeManagementCommand);
    }
    if (!state.nodeManagementRename.trim()) {
      state.nodeManagementRename = getNodeDisplayName(selected);
    }
    return;
  }

  const first = state.nodes.find((node) => getNodeId(node));
  if (!first) {
    state.nodeManagementSelectedId = null;
    state.nodeManagementRename = "";
    state.nodeManagementCommand = "";
    return;
  }
  selectNodeForManagement(state, getNodeId(first) ?? "");
}

function parseJsonParams(text: string): unknown {
  const raw = text.trim();
  if (!raw) {
    return {};
  }
  return JSON.parse(raw);
}

function parseTimeoutMs(value: string, fallback: number): number {
  const parsed = Number.parseInt(value.trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function newIdempotencyKey(prefix: string): string {
  const cryptoValue = globalThis.crypto?.randomUUID?.();
  return `${prefix}:${cryptoValue ?? `${Date.now()}:${Math.random().toString(36).slice(2)}`}`;
}

function resolveShellArgv(node: Record<string, unknown> | null, commandText: string): string[] {
  const platform = normalizeOptionalString(node?.platform)?.toLowerCase() ?? "";
  if (platform.startsWith("win")) {
    return ["cmd.exe", "/d", "/s", "/c", commandText];
  }
  return ["sh", "-lc", commandText];
}

function defaultParamsForCommand(command: string): string {
  if (command === "system.which") {
    return '{\n  "bins": ["genesis", "node", "pnpm"]\n}';
  }
  if (command === "system.run") {
    return '{\n  "command": ["genesis", "--version"]\n}';
  }
  return "{\n}";
}

function applyNodeManagementResult(
  state: NodesState,
  params: { label: string; nodeId: string; command: string; response: NodeInvokeResponse },
) {
  state.nodeManagementResult = {
    label: params.label,
    nodeId: params.nodeId,
    command: params.command,
    ok: params.response.ok !== false,
    payload: params.response.payload ?? params.response,
    completedAtMs: Date.now(),
  };
}

export async function loadNodes(state: NodesState, opts?: { quiet?: boolean }) {
  if (!state.client || !state.connected) {
    return;
  }
  if (state.nodesLoading) {
    return;
  }
  state.nodesLoading = true;
  if (!opts?.quiet) {
    state.lastError = null;
  }
  try {
    const res = await state.client.request<{ nodes?: Record<string, unknown> }>("node.list", {});
    state.nodes = Array.isArray(res.nodes) ? res.nodes : [];
    syncNodeManagementSelection(state);
  } catch (err) {
    if (!opts?.quiet) {
      state.lastError = String(err);
    }
  } finally {
    state.nodesLoading = false;
  }
}

export function selectNodeForManagement(state: NodesState, nodeId: string) {
  const node = findNodeById(state.nodes, nodeId);
  const id = getNodeId(node ?? { nodeId }) ?? nodeId.trim();
  state.nodeManagementSelectedId = id || null;
  state.nodeManagementRename = node ? getNodeDisplayName(node) : "";
  state.nodeManagementCommand = firstRunnableCommand(node);
  state.nodeManagementParams = defaultParamsForCommand(state.nodeManagementCommand);
  state.nodeManagementError = null;
  state.nodeManagementResult = null;
}

export function updateNodeManagementCommand(state: NodesState, command: string) {
  const normalized = command.trim();
  state.nodeManagementCommand = normalized;
  state.nodeManagementParams = defaultParamsForCommand(normalized);
}

export async function renameSelectedNode(state: NodesState) {
  if (!state.client || !state.connected) {
    return;
  }
  const nodeId = normalizeOptionalString(state.nodeManagementSelectedId);
  const displayName = state.nodeManagementRename.trim();
  if (!nodeId || !displayName) {
    state.nodeManagementError = "Select a node and enter a display name.";
    return;
  }
  state.nodeManagementBusy = true;
  state.nodeManagementError = null;
  try {
    await state.client.request("node.rename", { nodeId, displayName });
    await loadNodes(state, { quiet: true });
    state.nodeManagementResult = {
      label: "Rename node",
      nodeId,
      command: "node.rename",
      ok: true,
      payload: { nodeId, displayName },
      completedAtMs: Date.now(),
    };
  } catch (err) {
    state.nodeManagementError = String(err);
  } finally {
    state.nodeManagementBusy = false;
  }
}

export async function invokeSelectedNodeCommand(state: NodesState) {
  if (!state.client || !state.connected) {
    return;
  }
  const nodeId = normalizeOptionalString(state.nodeManagementSelectedId);
  const command = state.nodeManagementCommand.trim();
  if (!nodeId || !command) {
    state.nodeManagementError = "Select a node command to run.";
    return;
  }
  state.nodeManagementBusy = true;
  state.nodeManagementError = null;
  try {
    const timeoutMs = parseTimeoutMs(state.nodeManagementTimeoutMs, 120_000);
    const params = parseJsonParams(state.nodeManagementParams);
    const res = await state.client.request<NodeInvokeResponse>("node.invoke", {
      nodeId,
      command,
      params,
      timeoutMs,
      idempotencyKey: newIdempotencyKey("control-ui-node-command"),
    });
    applyNodeManagementResult(state, {
      label: "Run node command",
      nodeId,
      command,
      response: res,
    });
  } catch (err) {
    state.nodeManagementError = String(err);
  } finally {
    state.nodeManagementBusy = false;
  }
}

export async function runSelectedNodeShellCommand(state: NodesState) {
  if (!state.client || !state.connected) {
    return;
  }
  const nodeId = normalizeOptionalString(state.nodeManagementSelectedId);
  const commandText = state.nodeManagementShell.trim();
  if (!nodeId || !commandText) {
    state.nodeManagementError = "Select a node and enter a shell command.";
    return;
  }
  const node = findNodeById(state.nodes, nodeId);
  state.nodeManagementBusy = true;
  state.nodeManagementError = null;
  try {
    const timeoutMs = parseTimeoutMs(state.nodeManagementTimeoutMs, 120_000);
    const res = await state.client.request<NodeInvokeResponse>("node.invoke", {
      nodeId,
      command: "system.run",
      params: {
        command: resolveShellArgv(node, commandText),
        rawCommand: commandText,
        cwd: state.nodeManagementCwd.trim() || null,
        timeoutMs,
        suppressNotifyOnExit: true,
      },
      timeoutMs: timeoutMs + 5_000,
      idempotencyKey: newIdempotencyKey("control-ui-node-shell"),
    });
    applyNodeManagementResult(state, {
      label: "Run shell command",
      nodeId,
      command: "system.run",
      response: res,
    });
  } catch (err) {
    state.nodeManagementError = String(err);
  } finally {
    state.nodeManagementBusy = false;
  }
}

export async function runSelectedNodePreset(state: NodesState, preset: NodeManagementPreset) {
  if (!state.client || !state.connected) {
    return;
  }
  const nodeId = normalizeOptionalString(state.nodeManagementSelectedId);
  if (!nodeId) {
    state.nodeManagementError = "Select a node first.";
    return;
  }
  const specs: Record<
    NodeManagementPreset,
    {
      label: string;
      command: string;
      params: unknown;
      timeoutMs: number;
      confirm?: string;
    }
  > = {
    "update-status": {
      label: "Update status",
      command: "system.run",
      params: {
        command: ["genesis", "update", "status", "--json"],
        timeoutMs: 60_000,
        suppressNotifyOnExit: true,
      },
      timeoutMs: 65_000,
    },
    "update-run": {
      label: "Update Genesis",
      command: "system.run",
      params: {
        command: ["genesis", "update", "--yes", "--json"],
        timeoutMs: 1_200_000,
        suppressNotifyOnExit: true,
      },
      timeoutMs: 1_205_000,
      confirm: "Run Genesis update on this node?",
    },
    "restart-service": {
      label: "Restart node service",
      command: "system.run",
      params: {
        command: ["genesis", "node", "restart", "--json"],
        timeoutMs: 120_000,
        suppressNotifyOnExit: true,
      },
      timeoutMs: 125_000,
      confirm: "Restart the Genesis node service on this node?",
    },
    "which-genesis": {
      label: "Find Genesis CLI",
      command: "system.which",
      params: { bins: ["genesis", "node", "pnpm"] },
      timeoutMs: 30_000,
    },
  };
  const spec = specs[preset];
  if (spec.confirm && !window.confirm(spec.confirm)) {
    return;
  }
  state.nodeManagementBusy = true;
  state.nodeManagementError = null;
  try {
    const res = await state.client.request<NodeInvokeResponse>("node.invoke", {
      nodeId,
      command: spec.command,
      params: spec.params,
      timeoutMs: spec.timeoutMs,
      idempotencyKey: newIdempotencyKey(`control-ui-node-${preset}`),
    });
    applyNodeManagementResult(state, {
      label: spec.label,
      nodeId,
      command: spec.command,
      response: res,
    });
    if (preset === "update-run" || preset === "restart-service") {
      await loadNodes(state, { quiet: true });
    }
  } catch (err) {
    state.nodeManagementError = String(err);
  } finally {
    state.nodeManagementBusy = false;
  }
}
