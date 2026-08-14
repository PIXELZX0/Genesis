import { describe, expect, it, vi } from "vitest";

vi.mock("../channels/plugins/index.js", () => ({
  listChannelPlugins: () => [
    {
      id: "matrix",
      reload: {
        configPrefixes: ["channels.matrix"],
        noopPrefixes: [
          "channels.matrix.avatarUrl",
          "channels.matrix.name",
          "channels.matrix.accounts.*.avatarUrl",
          "channels.matrix.accounts.*.name",
        ],
      },
    },
  ],
}));
vi.mock("../plugins/runtime.js", () => ({
  getActivePluginRegistry: () => null,
  getActivePluginRegistryVersion: () => 0,
  getActivePluginChannelRegistryVersion: () => 0,
}));

const { buildGatewayReloadPlan } = await import("./config-reload-plan.js");

describe("buildGatewayReloadPlan", () => {
  it("does not restart the channel for a default-account avatarUrl self-write", () => {
    const plan = buildGatewayReloadPlan(["channels.matrix.avatarUrl"]);
    expect(plan.restartGateway).toBe(false);
    expect(plan.restartChannels.size).toBe(0);
  });

  it("does not restart the channel for a named-account avatarUrl self-write", () => {
    const plan = buildGatewayReloadPlan(["channels.matrix.accounts.work.avatarUrl"]);
    expect(plan.restartGateway).toBe(false);
    expect(plan.restartChannels.size).toBe(0);
  });

  it("still hot-restarts the channel for a real named-account config change", () => {
    const plan = buildGatewayReloadPlan(["channels.matrix.accounts.work.homeserver"]);
    expect(plan.restartGateway).toBe(false);
    expect(plan.restartChannels.has("matrix")).toBe(true);
  });

  it.each([
    ["create", "agents.list[1].id"],
    ["create", "agents.list[1].workspace"],
    ["create", "agents.list[1].model"],
    ["update", "agents.list[0].workspace"],
    ["update", "agents.list[0].model"],
    ["delete", "agents.list[1].id"],
    ["delete", "agents.list[1].workspace"],
    ["delete", "agents.list[1].model"],
  ] as const)(
    "classifies persisted agent %s path %s as hot without a full gateway restart",
    (_operation, path) => {
      const plan = buildGatewayReloadPlan([path]);
      expect(plan.restartGateway).toBe(false);
      expect(plan.restartReasons).toEqual([]);
      expect(plan.hotReasons).toEqual([path]);
    },
  );

  it("falls back to a full gateway restart for an unrecognized path", () => {
    const plan = buildGatewayReloadPlan(["totallyUnknownSection.value"]);
    expect(plan.restartGateway).toBe(true);
  });
});
