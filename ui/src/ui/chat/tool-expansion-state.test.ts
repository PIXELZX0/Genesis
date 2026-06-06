import { afterEach, describe, expect, it } from "vitest";
import { getExpandedToolCards, resetToolExpansionStateForTest } from "./tool-expansion-state.ts";

afterEach(() => {
  resetToolExpansionStateForTest();
});

describe("tool expansion state", () => {
  it("starts with an empty map so work blocks are collapsed by default", () => {
    const expanded = getExpandedToolCards("main");
    expect(expanded.size).toBe(0);
    expect(expanded.get("work:group:assistant:assistant-1")).toBeUndefined();
  });

  it("returns a stable per-session map that retains toggled disclosures", () => {
    const first = getExpandedToolCards("main");
    first.set("work:group:assistant:assistant-1", true);

    const again = getExpandedToolCards("main");
    expect(again).toBe(first);
    expect(again.get("work:group:assistant:assistant-1")).toBe(true);

    expect(getExpandedToolCards("other").size).toBe(0);
  });
});
