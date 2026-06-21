import { describe, expect, it } from "vitest";
import { TAB_GROUPS, tabFromPath } from "./navigation.ts";

describe("TAB_GROUPS", () => {
  it("publishes Canvas in the Control group", () => {
    const control = TAB_GROUPS.find((group) => group.label === "control");
    expect(control?.tabs).toContain("canvas");
    expect(tabFromPath("/canvas")).toBe("canvas");
  });

  it("does not expose settings slices as a sidebar group", () => {
    // Settings is rendered as a single footer item (see app-render), not a
    // TAB_GROUP. The individual settings slices stay URL-routable.
    const labels: readonly string[] = TAB_GROUPS.map((group) => group.label);
    expect(labels).not.toContain("settings");
  });

  it("routes every settings slice even though it is not in the sidebar groups", () => {
    expect(tabFromPath("/communications")).toBe("communications");
    expect(tabFromPath("/appearance")).toBe("appearance");
    expect(tabFromPath("/automation")).toBe("automation");
    expect(tabFromPath("/infrastructure")).toBe("infrastructure");
    expect(tabFromPath("/ai-agents")).toBe("aiAgents");
    expect(tabFromPath("/config")).toBe("config");
  });
});
