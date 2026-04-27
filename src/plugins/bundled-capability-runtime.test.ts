import { describe, expect, it } from "vitest";
import { buildVitestCapabilityShimAliasMap } from "./bundled-capability-runtime.js";

describe("buildVitestCapabilityShimAliasMap", () => {
  it("keeps scoped and unscoped capability shim aliases aligned", () => {
    const aliasMap = buildVitestCapabilityShimAliasMap();

    expect(aliasMap["genesis/plugin-sdk/llm-task"]).toBe(aliasMap["@genesis/plugin-sdk/llm-task"]);
    expect(aliasMap["genesis/plugin-sdk/config-runtime"]).toBe(
      aliasMap["@genesis/plugin-sdk/config-runtime"],
    );
    expect(aliasMap["genesis/plugin-sdk/media-runtime"]).toBe(
      aliasMap["@genesis/plugin-sdk/media-runtime"],
    );
    expect(aliasMap["genesis/plugin-sdk/provider-onboard"]).toBe(
      aliasMap["@genesis/plugin-sdk/provider-onboard"],
    );
    expect(aliasMap["genesis/plugin-sdk/speech-core"]).toBe(
      aliasMap["@genesis/plugin-sdk/speech-core"],
    );
  });
});
