import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  invokeSelectedNodeCommand,
  loadNodes,
  renameSelectedNode,
  runSelectedNodePreset,
  runSelectedNodeShellCommand,
  selectNodeForManagement,
  type NodesState,
} from "./nodes.ts";

type RequestFn = (method: string, params?: unknown) => Promise<unknown>;

function createState(request: RequestFn, overrides: Partial<NodesState> = {}): NodesState {
  return {
    client: { request } as unknown as NodesState["client"],
    connected: true,
    nodesLoading: false,
    nodes: [],
    lastError: null,
    nodeManagementSelectedId: null,
    nodeManagementRename: "",
    nodeManagementCommand: "",
    nodeManagementParams: "{\n}",
    nodeManagementShell: "genesis --version",
    nodeManagementCwd: "",
    nodeManagementTimeoutMs: "120000",
    nodeManagementBusy: false,
    nodeManagementError: null,
    nodeManagementResult: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.stubGlobal("crypto", { randomUUID: () => "uuid-1" });
  vi.stubGlobal("window", { confirm: () => true });
});

describe("loadNodes", () => {
  it("selects the first manageable node and default command", async () => {
    const request = vi.fn(async () => ({
      nodes: [
        {
          nodeId: "node-1",
          displayName: "Build Box",
          commands: ["system.which", "system.run"],
        },
      ],
    }));
    const state = createState(request);

    await loadNodes(state);

    expect(state.nodeManagementSelectedId).toBe("node-1");
    expect(state.nodeManagementRename).toBe("Build Box");
    expect(state.nodeManagementCommand).toBe("system.run");
    expect(state.nodeManagementParams).toContain('"command"');
  });
});

describe("node management actions", () => {
  it("renames the selected node and refreshes the list", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "node.rename") {
        return { ok: true };
      }
      if (method === "node.list") {
        return { nodes: [{ nodeId: "node-1", displayName: "Renamed" }] };
      }
      throw new Error(`unexpected method: ${method}`);
    });
    const state = createState(request, {
      nodeManagementSelectedId: "node-1",
      nodeManagementRename: "Renamed",
    });

    await renameSelectedNode(state);

    expect(request).toHaveBeenNthCalledWith(1, "node.rename", {
      nodeId: "node-1",
      displayName: "Renamed",
    });
    expect(request).toHaveBeenNthCalledWith(2, "node.list", {});
    expect(state.nodeManagementResult?.command).toBe("node.rename");
  });

  it("invokes an advertised command with parsed JSON params", async () => {
    const request = vi.fn(async () => ({
      ok: true,
      payload: { bins: { genesis: "/bin/genesis" } },
    }));
    const state = createState(request, {
      nodeManagementSelectedId: "node-1",
      nodeManagementCommand: "system.which",
      nodeManagementParams: '{ "bins": ["genesis"] }',
      nodeManagementTimeoutMs: "30000",
    });

    await invokeSelectedNodeCommand(state);

    expect(request).toHaveBeenCalledWith("node.invoke", {
      nodeId: "node-1",
      command: "system.which",
      params: { bins: ["genesis"] },
      timeoutMs: 30000,
      idempotencyKey: "control-ui-node-command:uuid-1",
    });
    expect(state.nodeManagementResult?.label).toBe("Run node command");
  });

  it("runs shell text through system.run on POSIX nodes", async () => {
    const request = vi.fn(async () => ({ ok: true, payload: { exitCode: 0, stdout: "hi\n" } }));
    const state = createState(request, {
      nodes: [{ nodeId: "node-1", platform: "linux", commands: ["system.run"] }],
      nodeManagementSelectedId: "node-1",
      nodeManagementShell: "echo hi",
      nodeManagementCwd: "/tmp",
      nodeManagementTimeoutMs: "45000",
    });

    await runSelectedNodeShellCommand(state);

    expect(request).toHaveBeenCalledWith("node.invoke", {
      nodeId: "node-1",
      command: "system.run",
      params: {
        command: ["sh", "-lc", "echo hi"],
        rawCommand: "echo hi",
        cwd: "/tmp",
        timeoutMs: 45000,
        suppressNotifyOnExit: true,
      },
      timeoutMs: 50000,
      idempotencyKey: "control-ui-node-shell:uuid-1",
    });
  });

  it("runs the update preset through node system.run after confirmation", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "node.invoke") {
        return { ok: true, payload: { exitCode: 0 } };
      }
      if (method === "node.list") {
        return { nodes: [] };
      }
      throw new Error(`unexpected method: ${method}`);
    });
    const state = createState(request, { nodeManagementSelectedId: "node-1" });

    await runSelectedNodePreset(state, "update-run");

    expect(request).toHaveBeenNthCalledWith(1, "node.invoke", {
      nodeId: "node-1",
      command: "system.run",
      params: {
        command: ["genesis", "update", "--yes", "--json"],
        timeoutMs: 1_200_000,
        suppressNotifyOnExit: true,
      },
      timeoutMs: 1_205_000,
      idempotencyKey: "control-ui-node-update-run:uuid-1",
    });
    expect(state.nodeManagementResult?.label).toBe("Update Genesis");
  });

  it("updates the command params when selecting another node command", () => {
    const state = createState(async () => ({}), {
      nodes: [{ nodeId: "node-1", displayName: "Node", commands: ["system.which"] }],
    });

    selectNodeForManagement(state, "node-1");

    expect(state.nodeManagementCommand).toBe("system.which");
    expect(state.nodeManagementParams).toContain('"bins"');
  });
});
