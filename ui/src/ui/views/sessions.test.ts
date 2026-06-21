/* @vitest-environment jsdom */

import { render } from "lit";
import { describe, expect, it } from "vitest";
import { withoutArrayCopyMethods } from "../test-helpers/array-copy-methods.ts";
import type { SessionsListResult } from "../types.ts";
import { renderSessions, type SessionsProps } from "./sessions.ts";

function buildMultiResult(sessions: SessionsListResult["sessions"]): SessionsListResult {
  return {
    ts: Date.now(),
    path: "(multiple)",
    count: sessions.length,
    defaults: { modelProvider: null, model: null, contextTokens: null },
    sessions,
  };
}

function buildProps(result: SessionsListResult): SessionsProps {
  return {
    loading: false,
    result,
    error: null,
    activeMinutes: "",
    limit: "120",
    includeGlobal: false,
    includeUnknown: false,
    basePath: "",
    searchQuery: "",
    sortColumn: "updated",
    sortDir: "desc",
    page: 0,
    pageSize: 10,
    selectedKeys: new Set<string>(),
    expandedCheckpointKey: null,
    checkpointItemsByKey: {},
    checkpointLoadingKey: null,
    checkpointBusyKey: null,
    checkpointErrorByKey: {},
    onFiltersChange: () => undefined,
    onSearchChange: () => undefined,
    onSortChange: () => undefined,
    onPageChange: () => undefined,
    onPageSizeChange: () => undefined,
    onRefresh: () => undefined,
    onPatch: () => undefined,
    onToggleSelect: () => undefined,
    onSelectPage: () => undefined,
    onDeselectPage: () => undefined,
    onDeselectAll: () => undefined,
    onDeleteSelected: () => undefined,
    onToggleCheckpointDetails: () => undefined,
    onBranchFromCheckpoint: () => undefined,
    onRestoreCheckpoint: () => undefined,
  };
}

describe("sessions view", () => {
  it("renders sessions when browser array copy methods are unavailable", async () => {
    const container = document.createElement("div");

    withoutArrayCopyMethods(() =>
      render(
        renderSessions(
          buildProps(
            buildMultiResult([
              { key: "older", kind: "direct", updatedAt: 10 },
              { key: "newer", kind: "direct", updatedAt: 20 },
            ]),
          ),
        ),
        container,
      ),
    );
    await Promise.resolve();

    expect(container.textContent).toContain("Sessions");
    expect(container.textContent).toContain("newer");
  });

  it("renders the Pencil columns and one row per session", async () => {
    const container = document.createElement("div");
    render(
      renderSessions(
        buildProps(
          buildMultiResult([
            {
              key: "alpha",
              kind: "direct",
              updatedAt: Date.now(),
              displayName: "orchestrator",
              surface: "telegram",
            },
            { key: "beta", kind: "group", updatedAt: 1000 },
          ]),
        ),
      ),
      container,
    );
    await Promise.resolve();

    const text = container.textContent ?? "";
    expect(text).toContain("SESSION");
    expect(text).toContain("CHANNEL");
    expect(text).toContain("STATUS");
    expect(text).toContain("alpha");
    expect(text).toContain("orchestrator");
    expect(text).toContain("telegram");
    expect(container.querySelectorAll("a.table-row").length).toBe(2);
  });

  it("filters rows by search query", async () => {
    const container = document.createElement("div");
    render(
      renderSessions({
        ...buildProps(
          buildMultiResult([
            { key: "alpha", kind: "direct", updatedAt: 1 },
            { key: "beta", kind: "direct", updatedAt: 2 },
          ]),
        ),
        searchQuery: "alph",
      }),
      container,
    );
    await Promise.resolve();

    expect(container.querySelectorAll("a.table-row").length).toBe(1);
    expect(container.textContent).toContain("alpha");
  });
});
