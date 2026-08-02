/* @vitest-environment jsdom */

import DOMPurify from "dompurify";
import { render } from "lit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { md } from "../markdown.ts";
import type { MessageGroup } from "../types/chat-types.ts";
import { renderMessageGroup, renderStreamingGroup } from "./grouped-render.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("streaming Markdown rendering", () => {
  it("skips parsing and sanitizing cumulative deltas, then renders final Markdown once", () => {
    const parseSpy = vi.spyOn(md, "render");
    const sanitizeSpy = vi.spyOn(DOMPurify, "sanitize");
    const container = document.createElement("div");
    const finalMarkdown =
      "First line\n  preserved indentation <img src=x onerror=alert(1)>\n\n**final bold text**";

    for (let end = 1; end <= finalMarkdown.length; end += 1) {
      render(renderStreamingGroup(finalMarkdown.slice(0, end), 1_000), container);
    }

    const streamingText = container.querySelector<HTMLElement>(".chat-text--streaming");
    expect(parseSpy).not.toHaveBeenCalled();
    expect(sanitizeSpy).not.toHaveBeenCalled();
    expect(streamingText?.textContent).toBe(finalMarkdown);
    expect(streamingText?.querySelector("img")).toBeNull();

    const finalGroup: MessageGroup = {
      kind: "group",
      key: "final-markdown-group",
      role: "assistant",
      messages: [
        {
          key: "final-markdown-message",
          message: {
            role: "assistant",
            content: [{ type: "text", text: finalMarkdown }],
            timestamp: 2_000,
          },
        },
      ],
      timestamp: 2_000,
      isStreaming: false,
    };
    const renderFinal = () =>
      render(
        renderMessageGroup(finalGroup, {
          showReasoning: false,
          showToolCalls: false,
        }),
        container,
      );

    renderFinal();
    renderFinal();

    expect(parseSpy).toHaveBeenCalledTimes(1);
    expect(sanitizeSpy).toHaveBeenCalledTimes(1);
    expect(container.querySelector(".chat-text strong")?.textContent).toBe("final bold text");
    expect(container.querySelector(".chat-text img")).toBeNull();
    expect(container.querySelector(".chat-text")?.textContent).toContain(
      "<img src=x onerror=alert(1)>",
    );
  });

  it("parses and sanitizes a committed stream segment once", () => {
    const parseSpy = vi.spyOn(md, "render");
    const sanitizeSpy = vi.spyOn(DOMPurify, "sanitize");
    const container = document.createElement("div");
    const committedMarkdown = "Committed segment with **rendered Markdown**.";
    const renderCommitted = () =>
      render(
        renderStreamingGroup(
          committedMarkdown,
          3_000,
          undefined,
          undefined,
          undefined,
          null,
          false,
        ),
        container,
      );

    renderCommitted();
    renderCommitted();

    expect(parseSpy).toHaveBeenCalledTimes(1);
    expect(sanitizeSpy).toHaveBeenCalledTimes(1);
    expect(container.querySelector(".chat-text strong")?.textContent).toBe("rendered Markdown");
    expect(container.querySelector(".chat-text--streaming")).toBeNull();
  });
});
