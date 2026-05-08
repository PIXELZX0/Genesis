/* @vitest-environment jsdom */

import { render } from "lit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GatewayBrowserClient } from "../gateway.ts";
import { renderCanvas, resetCanvasViewForTests, type CanvasProps } from "./canvas.ts";

const manifest = {
  id: "cv_test",
  kind: "html_bundle",
  title: "Test canvas",
  createdAt: "2026-05-08T00:00:00.000Z",
  revision: 1,
  entryUrl: "/__genesis__/canvas/documents/cv_test/index.html",
  localEntrypoint: "index.html",
  assets: [],
} as const;

function createClient(request: ReturnType<typeof vi.fn>): GatewayBrowserClient {
  return {
    request,
  } as unknown as GatewayBrowserClient;
}

function createProps(overrides: Partial<CanvasProps> = {}): CanvasProps {
  return {
    connected: true,
    client: null,
    gatewayUrl: "ws://127.0.0.1:18789",
    authToken: "",
    password: "",
    basePath: "",
    canvasHostUrl: null,
    embedSandboxMode: "scripts",
    allowExternalEmbedUrls: false,
    onNavigateToChat: () => undefined,
    onRequestUpdate: () => undefined,
    ...overrides,
  };
}

async function renderView(container: HTMLElement, props: CanvasProps) {
  render(renderCanvas(props), container);
  await Promise.resolve();
}

async function flushAsync() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("canvas view", () => {
  beforeEach(() => {
    resetCanvasViewForTests();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the Canvas host preview with the configured sandbox", async () => {
    const container = document.createElement("div");

    await renderView(container, createProps({ embedSandboxMode: "trusted" }));

    const iframe = container.querySelector<HTMLIFrameElement>(".canvas-preview-frame");
    expect(container.textContent).toContain("Canvas");
    expect(iframe).not.toBeNull();
    expect(iframe?.getAttribute("src")).toBe("/__genesis__/canvas/");
    expect(iframe?.getAttribute("sandbox")).toBe("allow-scripts allow-same-origin");
  });

  it("rewrites stable Canvas paths through a scoped host URL", async () => {
    const container = document.createElement("div");

    await renderView(
      container,
      createProps({
        canvasHostUrl: "http://127.0.0.1:19003/__genesis__/cap/cap_123",
      }),
    );

    const iframe = container.querySelector<HTMLIFrameElement>(".canvas-preview-frame");
    expect(iframe?.getAttribute("src")).toBe(
      "http://127.0.0.1:19003/__genesis__/cap/cap_123/__genesis__/canvas/",
    );
  });

  it("blocks untrusted preview URLs", async () => {
    const container = document.createElement("div");
    const onRequestUpdate = vi.fn();
    const props = createProps({ onRequestUpdate });

    await renderView(container, props);
    const input = container.querySelector<HTMLInputElement>(".canvas-entry-field input");
    expect(input).not.toBeNull();
    if (!input) {
      return;
    }

    input.value = "https://example.com/embed.html";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await renderView(container, props);

    expect(onRequestUpdate).toHaveBeenCalled();
    expect(container.querySelector(".canvas-preview-frame")).toBeNull();
    expect(container.textContent).toContain("Only trusted Canvas URLs");
  });

  it("enables create after file selection and keeps update disabled until an id is present", async () => {
    const container = document.createElement("div");
    const props = createProps();

    await renderView(container, props);

    const createButton = container.querySelector<HTMLButtonElement>(".canvas-create-button");
    const updateButton = container.querySelector<HTMLButtonElement>(".canvas-update-button");
    expect(createButton?.disabled).toBe(true);
    expect(updateButton?.disabled).toBe(true);

    const fileInput = container.querySelector<HTMLInputElement>(
      '.canvas-file-field input[type="file"]',
    );
    expect(fileInput).not.toBeNull();
    Object.defineProperty(fileInput, "files", {
      configurable: true,
      value: [new File(["<h1>Hello</h1>"], "hello.html", { type: "text/html" })],
    });
    fileInput?.dispatchEvent(new Event("change", { bubbles: true }));
    await renderView(container, props);

    expect(container.querySelector<HTMLButtonElement>(".canvas-create-button")?.disabled).toBe(
      false,
    );
    expect(container.querySelector<HTMLButtonElement>(".canvas-update-button")?.disabled).toBe(
      true,
    );
  });

  it("uploads a selected file and previews the returned manifest", async () => {
    const container = document.createElement("div");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      statusText: "OK",
      json: async () => ({ ok: true, document: manifest }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const props = createProps({ authToken: "secret", gatewayUrl: "ws://127.0.0.1:18789/control" });

    await renderView(container, props);
    const fileInput = container.querySelector<HTMLInputElement>(
      '.canvas-file-field input[type="file"]',
    );
    Object.defineProperty(fileInput, "files", {
      configurable: true,
      value: [new File(["<h1>Hello</h1>"], "hello.html", { type: "text/html" })],
    });
    fileInput?.dispatchEvent(new Event("change", { bubbles: true }));
    await renderView(container, props);

    container.querySelector<HTMLButtonElement>(".canvas-create-button")?.click();
    await flushAsync();
    await renderView(container, props);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("http://127.0.0.1:18789/control/__genesis__/canvas-upload");
    expect(url).toContain("mode=create");
    expect((init.headers as Headers).get("Authorization")).toBe("Bearer secret");
    expect(container.querySelector<HTMLInputElement>(".canvas-entry-field input")?.value).toBe(
      manifest.entryUrl,
    );
    expect(
      container.querySelector<HTMLIFrameElement>(".canvas-preview-frame")?.getAttribute("src"),
    ).toBe(manifest.entryUrl);
  });

  it("creates inline HTML through RPC and refreshes the preview", async () => {
    const container = document.createElement("div");
    const request = vi.fn(async (method: string) => {
      if (method === "canvas.document.list") {
        return { documents: [] };
      }
      return manifest;
    });
    const props = createProps({ client: createClient(request) });

    await renderView(container, props);
    container.querySelectorAll<HTMLButtonElement>(".canvas-source-tab")[1]?.click();
    await renderView(container, props);
    container.querySelector<HTMLButtonElement>(".canvas-create-button")?.click();
    await flushAsync();
    await renderView(container, props);

    expect(request).toHaveBeenCalledWith(
      "canvas.document.create",
      expect.objectContaining({ html: expect.stringContaining("<!doctype html>") }),
    );
    expect(
      container.querySelector<HTMLIFrameElement>(".canvas-preview-frame")?.getAttribute("src"),
    ).toBe(manifest.entryUrl);
  });

  it("selects a recent Canvas document", async () => {
    const container = document.createElement("div");
    const request = vi.fn(async () => ({ documents: [manifest] }));
    const props = createProps({ client: createClient(request) });

    await renderView(container, props);
    await flushAsync();
    await renderView(container, props);

    container.querySelector<HTMLButtonElement>(".canvas-document-row")?.click();
    await renderView(container, props);

    expect(container.querySelector<HTMLInputElement>(".canvas-entry-field input")?.value).toBe(
      manifest.entryUrl,
    );
    expect(container.textContent).toContain("Selected cv_test");
  });

  it("renders RPC errors", async () => {
    const container = document.createElement("div");
    const request = vi.fn(async (method: string) => {
      if (method === "canvas.document.list") {
        return { documents: [] };
      }
      throw new Error("canvas failed");
    });
    const props = createProps({ client: createClient(request) });

    await renderView(container, props);
    container.querySelectorAll<HTMLButtonElement>(".canvas-source-tab")[1]?.click();
    await renderView(container, props);
    container.querySelector<HTMLButtonElement>(".canvas-create-button")?.click();
    await flushAsync();
    await renderView(container, props);

    expect(container.textContent).toContain("canvas failed");
  });
});
