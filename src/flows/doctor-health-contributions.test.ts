import { describe, expect, it, vi } from "vitest";
import {
  resolveDoctorHealthContributions,
  type DoctorHealthFlowContext,
} from "./doctor-health-contributions.js";

const mocks = vi.hoisted(() => ({
  maybeRepairBundledPluginRuntimeDeps: vi.fn(async () => undefined),
  checkGatewayHealth: vi.fn(async () => ({ healthOk: true })),
  noteGatewayChannelStatusIssues: vi.fn(async () => undefined),
  probeGatewayMemoryStatus: vi.fn(async () => ({ checked: true, ready: true })),
}));

vi.mock("../commands/doctor-bundled-plugin-runtime-deps.js", () => ({
  maybeRepairBundledPluginRuntimeDeps: mocks.maybeRepairBundledPluginRuntimeDeps,
}));

vi.mock("../commands/doctor-gateway-health.js", () => ({
  checkGatewayHealth: mocks.checkGatewayHealth,
  noteGatewayChannelStatusIssues: mocks.noteGatewayChannelStatusIssues,
  probeGatewayMemoryStatus: mocks.probeGatewayMemoryStatus,
}));

function createContext(params: {
  bundledPluginRuntimeDepsChecked?: boolean;
  options?: DoctorHealthFlowContext["options"];
}): DoctorHealthFlowContext {
  const cfg = {};
  return {
    runtime: {},
    options: params.options ?? {},
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

  it("runs gateway channel and memory probes in parallel after gateway health succeeds", async () => {
    const contribution = resolveDoctorHealthContributions().find(
      (entry) => entry.id === "doctor:gateway-health",
    );
    expect(contribution).toBeTruthy();

    mocks.checkGatewayHealth.mockResolvedValueOnce({ healthOk: true });
    let releaseMemoryProbe!: () => void;
    let releaseChannelProbe!: () => void;
    const memoryProbeStarted = new Promise<void>((resolve) => {
      mocks.probeGatewayMemoryStatus.mockImplementationOnce(async () => {
        resolve();
        await new Promise<void>((release) => {
          releaseMemoryProbe = release;
        });
        return { checked: true, ready: true };
      });
    });
    const channelProbeStarted = new Promise<void>((resolve) => {
      mocks.noteGatewayChannelStatusIssues.mockImplementationOnce(async () => {
        resolve();
        await new Promise<void>((release) => {
          releaseChannelProbe = release;
        });
      });
    });
    const ctx = createContext({ options: { nonInteractive: true } });

    const run = contribution?.run(ctx);
    await Promise.all([memoryProbeStarted, channelProbeStarted]);

    expect(mocks.checkGatewayHealth).toHaveBeenCalledWith(
      expect.objectContaining({
        cfg: ctx.cfg,
        runtime: ctx.runtime,
        timeoutMs: 3000,
      }),
    );
    expect(mocks.probeGatewayMemoryStatus).toHaveBeenCalledWith({
      cfg: ctx.cfg,
      timeoutMs: 3000,
    });
    expect(mocks.noteGatewayChannelStatusIssues).toHaveBeenCalledOnce();

    releaseChannelProbe();
    releaseMemoryProbe();
    await run;

    expect(ctx.gatewayMemoryProbe).toEqual({ checked: true, ready: true });
  });

  it("skips gateway sub-probes when gateway health fails", async () => {
    const contribution = resolveDoctorHealthContributions().find(
      (entry) => entry.id === "doctor:gateway-health",
    );
    mocks.checkGatewayHealth.mockResolvedValueOnce({ healthOk: false });
    mocks.probeGatewayMemoryStatus.mockClear();
    mocks.noteGatewayChannelStatusIssues.mockClear();
    const ctx = createContext({});

    await contribution?.run(ctx);

    expect(mocks.probeGatewayMemoryStatus).not.toHaveBeenCalled();
    expect(mocks.noteGatewayChannelStatusIssues).not.toHaveBeenCalled();
    expect(ctx.gatewayMemoryProbe).toEqual({ checked: false, ready: false });
  });
});
