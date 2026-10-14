import { describe, expect, it } from "vitest";
import { shouldSkipWarningOnlyRespawnForArgv } from "./respawn-policy.js";

describe("shouldSkipWarningOnlyRespawnForArgv", () => {
  it("skips the warning-only respawn for the node host", () => {
    expect(shouldSkipWarningOnlyRespawnForArgv(["node", "genesis", "node", "run"])).toBe(true);
    expect(
      shouldSkipWarningOnlyRespawnForArgv(["node", "genesis", "node", "run", "--port", "18789"]),
    ).toBe(true);
  });

  it("keeps the respawn for other commands", () => {
    expect(shouldSkipWarningOnlyRespawnForArgv(["node", "genesis", "gateway", "run"])).toBe(false);
    expect(shouldSkipWarningOnlyRespawnForArgv(["node", "genesis", "node", "status"])).toBe(false);
    expect(shouldSkipWarningOnlyRespawnForArgv(["node", "genesis", "nodes", "list"])).toBe(false);
  });
});
