import { describe, expect, it } from "vitest";
import { buildMcpCliUsageSection, resolveMcpToolExposure } from "./pi-bundle-mcp-exposure.js";

describe("resolveMcpToolExposure", () => {
  it("defaults to cli", () => {
    expect(resolveMcpToolExposure()).toBe("cli");
    expect(resolveMcpToolExposure({ mcp: {} })).toBe("cli");
  });

  it("honors inject", () => {
    expect(resolveMcpToolExposure({ mcp: { toolExposure: "inject" } })).toBe("inject");
  });
});

describe("buildMcpCliUsageSection", () => {
  it("returns undefined without servers", () => {
    expect(buildMcpCliUsageSection([])).toBeUndefined();
  });

  it("lists sorted, deduped server names and the CLI commands", () => {
    const section = buildMcpCliUsageSection(["zeta", "alpha", "zeta"]);
    expect(section).toContain("Configured servers: alpha, zeta");
    expect(section).toContain("genesis mcp tools <server>");
    expect(section).toContain("genesis mcp call <server> <tool>");
  });
});
