import { describe, expect, it, vi } from "vitest";
import { NodeRegistry } from "./node-registry.js";
import type { GatewayWsClient } from "./server/ws-types.js";

function makeNodeClient(connId: string, deviceId = "node-1"): GatewayWsClient {
  return {
    connId,
    socket: { send: vi.fn() },
    connect: {
      client: { id: "node-host", mode: "node", version: "dev", platform: "linux" },
      device: { id: deviceId },
      caps: ["system"],
      commands: ["system.run"],
    },
  } as unknown as GatewayWsClient;
}

describe("NodeRegistry", () => {
  it("keeps the reconnected session when the superseded socket closes late", async () => {
    const registry = new NodeRegistry();
    registry.register(makeNodeClient("conn-old"), {});
    registry.register(makeNodeClient("conn-new"), {});

    const invoke = registry.invoke({ nodeId: "node-1", command: "system.run", timeoutMs: 1_000 });

    expect(registry.unregister("conn-old")).toBeNull();
    expect(registry.get("node-1")?.connId).toBe("conn-new");

    const [requestId] = (
      registry as unknown as { pendingInvokes: Map<string, unknown> }
    ).pendingInvokes.keys();
    expect(registry.handleInvokeResult({ id: requestId, nodeId: "node-1", ok: true })).toBe(true);
    await expect(invoke).resolves.toMatchObject({ ok: true });
  });

  it("removes the node and fails pending invokes when its live socket closes", async () => {
    const registry = new NodeRegistry();
    registry.register(makeNodeClient("conn-1"), {});

    const invoke = registry.invoke({ nodeId: "node-1", command: "system.run", timeoutMs: 1_000 });

    expect(registry.unregister("conn-1")).toBe("node-1");
    expect(registry.get("node-1")).toBeUndefined();
    await expect(invoke).rejects.toThrow("node disconnected (system.run)");
  });
});
