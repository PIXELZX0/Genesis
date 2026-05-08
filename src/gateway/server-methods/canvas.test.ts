import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createCanvasDocument: vi.fn(),
  inferCanvasDocumentKindFromSource: vi.fn((value: string, type: string) => {
    if (type === "html") {
      return "html_bundle";
    }
    if (value.endsWith(".pptx")) {
      return "presentation_asset";
    }
    return "html_bundle";
  }),
  loadConfig: vi.fn(),
  updateCanvasDocument: vi.fn(),
}));

vi.mock("../../config/config.js", () => ({
  loadConfig: mocks.loadConfig,
}));

vi.mock("../canvas-documents.js", () => ({
  createCanvasDocument: mocks.createCanvasDocument,
  inferCanvasDocumentKindFromSource: mocks.inferCanvasDocumentKindFromSource,
  updateCanvasDocument: mocks.updateCanvasDocument,
}));

const { canvasHandlers } = await import("./canvas.js");

async function invokeCanvasCreate(params: Record<string, unknown>) {
  let response: unknown[] | undefined;
  await canvasHandlers["canvas.document.create"]({
    params,
    respond: (...args: unknown[]) => {
      response = args;
    },
  } as never);
  return response;
}

async function invokeCanvasUpdate(params: Record<string, unknown>) {
  let response: unknown[] | undefined;
  await canvasHandlers["canvas.document.update"]({
    params,
    respond: (...args: unknown[]) => {
      response = args;
    },
  } as never);
  return response;
}

describe("canvas document gateway methods", () => {
  beforeEach(() => {
    mocks.createCanvasDocument.mockReset();
    mocks.updateCanvasDocument.mockReset();
    mocks.loadConfig.mockReset();
    mocks.loadConfig.mockReturnValue({ canvasHost: { root: "/tmp/genesis-canvas-root" } });
  });

  it("creates hosted html documents in the configured canvas root", async () => {
    const manifest = {
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
    };
    mocks.createCanvasDocument.mockResolvedValue(manifest);

    const response = await invokeCanvasCreate({
      id: "status-card",
      title: "Status",
      preferredHeight: 320,
      html: "<div>ok</div>",
    });

    expect(response).toEqual([true, manifest, undefined]);
    expect(mocks.createCanvasDocument).toHaveBeenCalledWith(
      {
        id: "status-card",
        kind: "html_bundle",
        title: "Status",
        preferredHeight: 320,
        surface: "assistant_message",
        entrypoint: { type: "html", value: "<div>ok</div>" },
      },
      {
        canvasRootDir: "/tmp/genesis-canvas-root",
        workspaceDir: undefined,
      },
    );
  });

  it("rejects requests without exactly one entrypoint", async () => {
    const response = await invokeCanvasCreate({
      html: "<div>ok</div>",
      url: "https://example.com/widget",
    });

    expect(response?.[0]).toBe(false);
    expect(JSON.stringify(response?.[2])).toContain("exactly one of html, path, or url");
    expect(mocks.createCanvasDocument).not.toHaveBeenCalled();
  });

  it("rejects creation when the canvas host is disabled", async () => {
    mocks.loadConfig.mockReturnValue({ canvasHost: { enabled: false } });

    const response = await invokeCanvasCreate({ html: "<div>ok</div>" });

    expect(response?.[0]).toBe(false);
    expect(JSON.stringify(response?.[2])).toContain("canvas host is disabled");
    expect(mocks.createCanvasDocument).not.toHaveBeenCalled();
  });

  it("updates hosted documents with the next revision", async () => {
    const manifest = {
      id: "status-card",
      kind: "presentation_asset",
      title: "Status",
      createdAt: "2026-05-05T00:00:00.000Z",
      updatedAt: "2026-05-05T00:01:00.000Z",
      revision: 2,
      entryUrl: "/__genesis__/canvas/documents/status-card/index.html",
      localEntrypoint: "index.html",
      sourceMime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      sourceFileName: "deck.pptx",
      viewer: "pptx",
      surface: "assistant_message",
      assets: [],
    };
    mocks.updateCanvasDocument.mockResolvedValue(manifest);

    const response = await invokeCanvasUpdate({
      id: "status-card",
      path: "deck.pptx",
      sourceFileName: "deck.pptx",
      viewerOptions: { theme: "dark" },
    });

    expect(response).toEqual([true, manifest, undefined]);
    expect(mocks.updateCanvasDocument).toHaveBeenCalledWith(
      {
        id: "status-card",
        kind: "presentation_asset",
        sourceFileName: "deck.pptx",
        surface: "assistant_message",
        entrypoint: { type: "path", value: "deck.pptx" },
        viewerOptions: { theme: "dark" },
      },
      {
        canvasRootDir: "/tmp/genesis-canvas-root",
        workspaceDir: undefined,
      },
    );
  });
});
