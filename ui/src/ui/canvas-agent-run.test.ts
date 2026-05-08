import { describe, expect, it, vi } from "vitest";
import {
  coerceCanvasAgentRunRequest,
  handleCanvasAgentRunMessage,
  isTrustedCanvasMessageSource,
} from "./canvas-agent-run.ts";

function createCanvasFrame(src = "/__genesis__/canvas/documents/cv_demo/index.html") {
  const root = document.createElement("div");
  const iframe = document.createElement("iframe");
  iframe.setAttribute("src", src);
  root.appendChild(iframe);
  document.body.appendChild(root);
  return {
    root,
    iframe,
    cleanup: () => root.remove(),
  };
}

describe("canvas agent run bridge", () => {
  it("coerces valid agent run requests", () => {
    expect(
      coerceCanvasAgentRunRequest({
        type: "genesis:canvas:agent-run-request",
        message: "  summarize this asset ",
        context: { docId: "cv_demo" },
      }),
    ).toEqual({ message: "summarize this asset", context: { docId: "cv_demo" } });
    expect(coerceCanvasAgentRunRequest({ type: "other", message: "hello" })).toBeNull();
  });

  it("trusts only hosted canvas iframe sources", () => {
    const { root, iframe, cleanup } = createCanvasFrame();
    try {
      expect(isTrustedCanvasMessageSource(iframe.contentWindow, root)).toBe(true);
      iframe.setAttribute("src", "https://example.com/embed.html");
      expect(isTrustedCanvasMessageSource(iframe.contentWindow, root)).toBe(false);
    } finally {
      cleanup();
    }
  });

  it("confirms before sending through chat", async () => {
    const { root, iframe, cleanup } = createCanvasFrame();
    const handleSendChat = vi.fn(async () => {});
    try {
      const handled = await handleCanvasAgentRunMessage(
        {
          connected: true,
          client: { request: vi.fn() } as never,
          sessionKey: "main",
          handleSendChat,
        },
        new MessageEvent("message", {
          data: {
            type: "genesis:canvas:agent-run-request",
            message: "Explain this model",
          },
          source: iframe.contentWindow,
        }),
        { root, confirm: () => true },
      );
      expect(handled).toBe(true);
      expect(handleSendChat).toHaveBeenCalledWith("Explain this model");
    } finally {
      cleanup();
    }
  });

  it("does not send when confirmation is cancelled", async () => {
    const { root, iframe, cleanup } = createCanvasFrame();
    const handleSendChat = vi.fn(async () => {});
    try {
      await handleCanvasAgentRunMessage(
        {
          connected: true,
          client: { request: vi.fn() } as never,
          sessionKey: "main",
          handleSendChat,
        },
        new MessageEvent("message", {
          data: {
            type: "genesis:canvas:agent-run-request",
            message: "Run this",
          },
          source: iframe.contentWindow,
        }),
        { root, confirm: () => false },
      );
      expect(handleSendChat).not.toHaveBeenCalled();
    } finally {
      cleanup();
    }
  });
});
