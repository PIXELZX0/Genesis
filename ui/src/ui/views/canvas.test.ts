/* @vitest-environment jsdom */

import { render } from "lit";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderCanvas, resetCanvasViewForTests, type CanvasProps } from "./canvas.ts";

function createProps(overrides: Partial<CanvasProps> = {}): CanvasProps {
  return {
    connected: true,
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

describe("canvas view", () => {
  beforeEach(() => {
    resetCanvasViewForTests();
  });

  it("renders the Canvas host preview with the configured sandbox", async () => {
    const container = document.createElement("div");

    await renderView(container, createProps({ embedSandboxMode: "trusted" }));

    const iframe = container.querySelector<HTMLIFrameElement>(".canvas-preview-frame");
    expect(container.textContent).toContain("Canvas");
    expect(container.textContent).toContain("PPTX, PPT");
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
});
