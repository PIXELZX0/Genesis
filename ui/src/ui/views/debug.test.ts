/* @vitest-environment jsdom */

import { render } from "lit";
import { describe, expect, it } from "vitest";
import type { DebugProps } from "./debug.ts";
import { renderDebug } from "./debug.ts";

function createProps(overrides: Partial<DebugProps> = {}): DebugProps {
  return {
    loading: false,
    status: { ok: true },
    health: { ok: true },
    models: [],
    eventLog: [{ ts: Date.now(), event: "health" }],
    methods: [],
    callMethod: "",
    callParams: "{}",
    callResult: null,
    callError: null,
    onCallMethodChange: () => undefined,
    onCallParamsChange: () => undefined,
    onRefresh: () => undefined,
    onCall: () => undefined,
    ...overrides,
  };
}

describe("renderDebug", () => {
  it("renders snapshots and event log", () => {
    const container = document.createElement("div");

    render(renderDebug(createProps()), container);

    expect(container.textContent).toContain("Status and health snapshots.");
    expect(container.textContent).toContain("Event Log");
  });
});
