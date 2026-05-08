import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const gatewayMocks = vi.hoisted(() => ({
  callGatewayTool: vi.fn(),
  readGatewayCallOptions: vi.fn(() => ({})),
}));

const nodeUtilsMocks = vi.hoisted(() => ({
  resolveNodeId: vi.fn(async () => "node-1"),
}));

vi.mock("./gateway.js", () => ({
  callGatewayTool: gatewayMocks.callGatewayTool,
  readGatewayCallOptions: gatewayMocks.readGatewayCallOptions,
}));

vi.mock("./nodes-utils.js", () => ({
  resolveNodeId: nodeUtilsMocks.resolveNodeId,
}));

let createCanvasTool: typeof import("./canvas-tool.js").createCanvasTool;

describe("createCanvasTool", () => {
  beforeAll(async () => {
    vi.resetModules();
    ({ createCanvasTool } = await import("./canvas-tool.js"));
  });

  beforeEach(() => {
    gatewayMocks.callGatewayTool.mockReset();
    gatewayMocks.readGatewayCallOptions.mockReset();
    gatewayMocks.readGatewayCallOptions.mockReturnValue({});
    nodeUtilsMocks.resolveNodeId.mockClear();
  });

  it("creates hosted Control UI documents without requiring a canvas-capable node", async () => {
    gatewayMocks.callGatewayTool.mockResolvedValue({
      id: "status-card",
      kind: "html_bundle",
      title: "Status",
      preferredHeight: 320,
      createdAt: "2026-05-05T00:00:00.000Z",
      revision: 1,
      entryUrl: "/__genesis__/canvas/documents/status-card/index.html",
      localEntrypoint: "index.html",
      surface: "assistant_message",
      assets: [],
    });
    const tool = createCanvasTool();

    const result = await tool.execute("call-1", {
      action: "create",
      id: "status-card",
      title: "Status",
      height: 320,
      html: "<div>ok</div>",
    });

    expect(nodeUtilsMocks.resolveNodeId).not.toHaveBeenCalled();
    expect(gatewayMocks.callGatewayTool).toHaveBeenCalledWith(
      "canvas.document.create",
      {},
      expect.objectContaining({
        id: "status-card",
        title: "Status",
        preferredHeight: 320,
        html: "<div>ok</div>",
        workspaceDir: process.cwd(),
      }),
    );
    const text = result?.content?.[0]?.type === "text" ? result.content[0].text : "";
    const preview = JSON.parse(text) as Record<string, unknown>;
    expect(preview.kind).toBe("canvas");
    expect(preview.embed).toBe('[embed ref="status-card" title="Status" height="320" /]');
    expect(preview.view).toEqual(
      expect.objectContaining({
        id: "status-card",
        url: "/__genesis__/canvas/documents/status-card/index.html",
      }),
    );
  });

  it("updates existing hosted Control UI documents without requiring a node", async () => {
    gatewayMocks.callGatewayTool.mockResolvedValue({
      id: "status-card",
      kind: "model_3d",
      title: "Status",
      createdAt: "2026-05-05T00:00:00.000Z",
      updatedAt: "2026-05-05T00:01:00.000Z",
      revision: 2,
      entryUrl: "/__genesis__/canvas/documents/status-card/index.html",
      localEntrypoint: "index.html",
      surface: "assistant_message",
      sourceFileName: "mesh.stl",
      viewer: "threejs",
      viewerOptions: { format: "stl" },
      assets: [],
    });
    const tool = createCanvasTool();

    const result = await tool.execute("call-2", {
      action: "update",
      id: "status-card",
      path: "mesh.stl",
      kind: "model_3d",
      sourceFileName: "mesh.stl",
      viewerOptions: { format: "stl" },
    });

    expect(nodeUtilsMocks.resolveNodeId).not.toHaveBeenCalled();
    expect(gatewayMocks.callGatewayTool).toHaveBeenCalledWith(
      "canvas.document.update",
      {},
      expect.objectContaining({
        id: "status-card",
        kind: "model_3d",
        path: "mesh.stl",
        sourceFileName: "mesh.stl",
        workspaceDir: process.cwd(),
        viewerOptions: { format: "stl" },
      }),
    );
    const text = result?.content?.[0]?.type === "text" ? result.content[0].text : "";
    const preview = JSON.parse(text) as Record<string, unknown>;
    expect(preview.embed).toBe('[embed ref="status-card" title="Status" /]');
    expect(preview.document).toEqual(expect.objectContaining({ revision: 2 }));
  });
});
