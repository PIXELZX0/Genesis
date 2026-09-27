import { describe, expect, it } from "vitest";
import { TAB_GROUPS, tabFromPath } from "./navigation.ts";

describe("TAB_GROUPS", () => {
  it("publishes Canvas in the Data group", () => {
    const data = TAB_GROUPS.find((group) => group.label === "data");
    expect(data?.tabs).toContain("canvas");
    expect(tabFromPath("/canvas")).toBe("canvas");
  });

  it("keeps everyday tabs in the unlabeled top group", () => {
    expect(TAB_GROUPS[0]).toMatchObject({ label: "control" });
    expect(TAB_GROUPS[0].tabs.slice(0, 2)).toEqual(["overview", "chat"]);
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
