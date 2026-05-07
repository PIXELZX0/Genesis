import { describe, expect, it, vi } from "vitest";
import {
  resolveDoctorHealthContributions,
  type DoctorHealthFlowContext,
} from "./doctor-health-contributions.js";

const mocks = vi.hoisted(() => ({
  maybeRepairBundledPluginRuntimeDeps: vi.fn(async () => undefined),
}));

vi.mock("../commands/doctor-bundled-plugin-runtime-deps.js", () => ({
  maybeRepairBundledPluginRuntimeDeps: mocks.maybeRepairBundledPluginRuntimeDeps,
}));

function createContext(params: {
  bundledPluginRuntimeDepsChecked?: boolean;
}): DoctorHealthFlowContext {
  const cfg = {};
  return {
    runtime: {},
    options: {},
    prompter: {},
    configResult: {
      cfg,
      bundledPluginRuntimeDepsChecked: params.bundledPluginRuntimeDepsChecked,
    },
    cfg,
    cfgForPersistence: cfg,
    sourceConfigValid: true,
    configPath: "/tmp/genesis.json",
  } as unknown as DoctorHealthFlowContext;
}

describe("doctor health contributions", () => {
  it("repairs bundled runtime deps before channel-owned doctor paths can import runtimes", () => {
    const ids = resolveDoctorHealthContributions().map((entry) => entry.id);

    expect(ids.indexOf("doctor:bundled-plugin-runtime-deps")).toBeGreaterThan(-1);
    expect(ids.indexOf("doctor:bundled-plugin-runtime-deps")).toBeLessThan(
      ids.indexOf("doctor:auth-profiles"),
    );
    expect(ids.indexOf("doctor:bundled-plugin-runtime-deps")).toBeLessThan(
      ids.indexOf("doctor:startup-channel-maintenance"),
    );
  });

  it("does not rescan bundled runtime deps after config flow already checked them", async () => {
    mocks.maybeRepairBundledPluginRuntimeDeps.mockClear();
    const contribution = resolveDoctorHealthContributions().find(
      (entry) => entry.id === "doctor:bundled-plugin-runtime-deps",
    );

    await contribution?.run(createContext({ bundledPluginRuntimeDepsChecked: true }));

    expect(mocks.maybeRepairBundledPluginRuntimeDeps).not.toHaveBeenCalled();
  });

  it("keeps the bundled runtime deps health pass when config flow did not check them", async () => {
    mocks.maybeRepairBundledPluginRuntimeDeps.mockClear();
    const contribution = resolveDoctorHealthContributions().find(
      (entry) => entry.id === "doctor:bundled-plugin-runtime-deps",
    );

    await contribution?.run(createContext({}));

    expect(mocks.maybeRepairBundledPluginRuntimeDeps).toHaveBeenCalledOnce();
  });
});
