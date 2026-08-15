/* @vitest-environment jsdom */

import { html, render } from "lit";
import { describe, expect, it, vi } from "vitest";
import type { MemoryProps } from "./memory.ts";
import { renderMemory } from "./memory.ts";

function createProps(overrides: Partial<MemoryProps> = {}): MemoryProps {
  return {
    connected: true,
    loading: false,
    agentId: "assistant",
    entries: [],
    error: null,
    onRefresh: vi.fn(),
    viewMode: "table",
    graph: { nodes: [], edges: [], generatedAtMs: 0 },
    graphLoading: false,
    graphError: null,
    onToggleView: vi.fn(),
    renderGraph: () => html`<div>graph</div>`,
    ...overrides,
  };
}

describe("renderMemory", () => {
  it("uses graph loading and error state for graph controls", () => {
    const container = document.createElement("div");
    const renderGraph = vi.fn(() => html`<div data-testid="memory-graph">graph</div>`);

    render(
      renderMemory(
        createProps({
          viewMode: "graph",
          error: "table error",
          graphLoading: true,
          graphError: "graph error",
          graph: {
            nodes: [{ name: "A", path: "a.md", size: 1, mtimeMs: 1 }],
            edges: [],
            generatedAtMs: 1,
          },
          renderGraph,
        }),
      ),
      container,
    );

    const buttons = container.querySelectorAll("button");
    expect(buttons[buttons.length - 1]?.disabled).toBe(true);
    expect(container.querySelectorAll(".callout.danger")).toHaveLength(1);
    expect(container.querySelector(".callout.danger")?.textContent).toBe("graph error");
    expect(renderGraph).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("table error");
  });
});
