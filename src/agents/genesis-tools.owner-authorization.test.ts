import { describe, expect, it } from "vitest";
import {
  isGenesisOwnerOnlyCoreToolName,
  GENESIS_OWNER_ONLY_CORE_TOOL_NAMES,
} from "./tools/owner-only-tools.js";

describe("createGenesisTools owner authorization", () => {
  it("marks owner-only core tool names", () => {
    expect(GENESIS_OWNER_ONLY_CORE_TOOL_NAMES).toEqual(["cron", "gateway", "nodes"]);
    expect(isGenesisOwnerOnlyCoreToolName("cron")).toBe(true);
    expect(isGenesisOwnerOnlyCoreToolName("gateway")).toBe(true);
    expect(isGenesisOwnerOnlyCoreToolName("nodes")).toBe(true);
  });

  it("keeps canvas non-owner-only", () => {
    expect(isGenesisOwnerOnlyCoreToolName("canvas")).toBe(false);
  });
});
