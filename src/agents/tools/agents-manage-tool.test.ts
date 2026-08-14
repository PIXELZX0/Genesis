import { beforeEach, describe, expect, it, vi } from "vitest";

const { callGatewayToolMock, readGatewayCallOptionsMock } = vi.hoisted(() => ({
  callGatewayToolMock: vi.fn(),
  readGatewayCallOptionsMock: vi.fn(),
}));

vi.mock("./gateway.js", () => ({
  callGatewayTool: callGatewayToolMock,
  readGatewayCallOptions: readGatewayCallOptionsMock,
}));

import { createAgentsManageTool } from "./agents-manage-tool.js";

describe("agents_manage", () => {
  beforeEach(() => {
    callGatewayToolMock.mockReset();
    readGatewayCallOptionsMock.mockReset();
    readGatewayCallOptionsMock.mockReturnValue({
      gatewayUrl: "ws://127.0.0.1:18789",
      gatewayToken: "test-token",
      timeoutMs: 4_000,
    });
    callGatewayToolMock.mockResolvedValue({ ok: true });
  });

  it("is marked owner-only control-plane", () => {
    const tool = createAgentsManageTool();

    expect(tool.ownerOnly).toBe(true);
    expect(tool.description).toContain("Owner-only control-plane");
  });

  it("exposes one flattened schema with action-specific fields", () => {
    const tool = createAgentsManageTool();
    const schema = tool.parameters as {
      type?: string;
      required?: string[];
      properties?: Record<string, { enum?: string[] }>;
    };

    expect(schema.type).toBe("object");
    expect(schema.required).toEqual(["action"]);
    expect(schema.properties?.action?.enum).toEqual(["list", "create", "update", "delete"]);
    expect(schema.properties).toEqual(
      expect.objectContaining({
        gatewayUrl: expect.any(Object),
        gatewayToken: expect.any(Object),
        timeoutMs: expect.any(Object),
        agentId: expect.any(Object),
        name: expect.any(Object),
        workspace: expect.any(Object),
        model: expect.any(Object),
        emoji: expect.any(Object),
        avatar: expect.any(Object),
        deleteFiles: expect.any(Object),
      }),
    );
  });

  it.each([
    ["list", { action: "list" }, "agents.list", {}],
    [
      "create",
      {
        action: "create",
        name: "Research Agent",
        workspace: "/tmp/research",
        model: "sonnet-4.6",
        emoji: "🔬",
        avatar: "https://example.com/research.png",
      },
      "agents.create",
      {
        name: "Research Agent",
        workspace: "/tmp/research",
        model: "sonnet-4.6",
        emoji: "🔬",
        avatar: "https://example.com/research.png",
      },
    ],
    [
      "update",
      {
        action: "update",
        agentId: "research-agent",
        name: "Updated Research Agent",
        workspace: "/tmp/research-v2",
        model: "gpt-5.4",
        emoji: "🧪",
        avatar: "https://example.com/research-v2.png",
      },
      "agents.update",
      {
        agentId: "research-agent",
        name: "Updated Research Agent",
        workspace: "/tmp/research-v2",
        model: "gpt-5.4",
        emoji: "🧪",
        avatar: "https://example.com/research-v2.png",
      },
    ],
    [
      "delete",
      { action: "delete", agentId: "research-agent", deleteFiles: false },
      "agents.delete",
      { agentId: "research-agent", deleteFiles: false },
    ],
  ] as const)(
    "routes %s through the matching Gateway method",
    async (_name, args, method, params) => {
      const tool = createAgentsManageTool();

      const result = await tool.execute("call-1", {
        ...args,
        gatewayUrl: "ws://127.0.0.1:18789",
        gatewayToken: "test-token",
        timeoutMs: 4_000,
      });

      expect(readGatewayCallOptionsMock).toHaveBeenCalledWith(
        expect.objectContaining({
          gatewayUrl: "ws://127.0.0.1:18789",
          gatewayToken: "test-token",
          timeoutMs: 4_000,
        }),
      );
      expect(callGatewayToolMock).toHaveBeenCalledWith(
        method,
        {
          gatewayUrl: "ws://127.0.0.1:18789",
          gatewayToken: "test-token",
          timeoutMs: 4_000,
        },
        params,
      );
      expect(result.details).toEqual({ ok: true });
    },
  );

  it.each([
    [{ action: "create", workspace: "/tmp/agent" }, "name"],
    [{ action: "create", name: "Agent" }, "workspace"],
    [{ action: "update" }, "agentId"],
    [{ action: "delete" }, "agentId"],
  ] as const)("rejects %s when required parameter %s is missing", async (args, field) => {
    const tool = createAgentsManageTool();

    await expect(tool.execute("call-invalid", args)).rejects.toThrow(`${field} required`);
    expect(callGatewayToolMock).not.toHaveBeenCalled();
  });

  it("rejects an unknown action before any Gateway call", async () => {
    const tool = createAgentsManageTool();

    await expect(tool.execute("call-invalid-action", { action: "replace" })).rejects.toThrow(
      "Unknown action: replace",
    );
    expect(callGatewayToolMock).not.toHaveBeenCalled();
  });
});
