import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createCanvasDocument: vi.fn(),
  loadConfig: vi.fn(),
}));

vi.mock("../../config/config.js", () => ({
  loadConfig: mocks.loadConfig,
}));

vi.mock("../canvas-documents.js", () => ({
  createCanvasDocument: mocks.createCanvasDocument,
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

describe("canvas document gateway methods", () => {
  beforeEach(() => {
    mocks.createCanvasDocument.mockReset();
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
});
