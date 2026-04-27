import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const loadConfigMock = vi.fn();
const applyPluginAutoEnableMock = vi.fn();
const loadGenesisPluginsMock = vi.fn();

let loadPluginMetadataRegistrySnapshot: typeof import("./metadata-registry-loader.js").loadPluginMetadataRegistrySnapshot;

vi.mock("../../config/config.js", () => ({
  loadConfig: () => loadConfigMock(),
}));

vi.mock("../../config/plugin-auto-enable.js", () => ({
  applyPluginAutoEnable: (...args: unknown[]) => applyPluginAutoEnableMock(...args),
}));

vi.mock("../loader.js", () => ({
  loadGenesisPlugins: (...args: unknown[]) => loadGenesisPluginsMock(...args),
}));

vi.mock("../../agents/agent-scope.js", () => ({
  resolveAgentWorkspaceDir: () => "/resolved-workspace",
  resolveDefaultAgentId: () => "default",
}));

describe("loadPluginMetadataRegistrySnapshot", () => {
  beforeAll(async () => {
    ({ loadPluginMetadataRegistrySnapshot } = await import("./metadata-registry-loader.js"));
  });

  beforeEach(() => {
    loadConfigMock.mockReset();
    applyPluginAutoEnableMock.mockReset();
    loadGenesisPluginsMock.mockReset();
    loadConfigMock.mockReturnValue({ plugins: {} });
    applyPluginAutoEnableMock.mockImplementation((params: { config: unknown }) => ({
      config: params.config,
      changes: [],
      autoEnabledReasons: {},
    }));
    loadGenesisPluginsMock.mockReturnValue({ plugins: [], diagnostics: [] });
  });

  it("defaults to a non-activating validate snapshot", () => {
    loadPluginMetadataRegistrySnapshot({
      config: { plugins: {} },
      activationSourceConfig: { plugins: { allow: ["demo"] } },
      env: { HOME: "/tmp/genesis-home" } as NodeJS.ProcessEnv,
      workspaceDir: "/workspace",
      onlyPluginIds: ["demo"],
    });

    expect(loadGenesisPluginsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        config: { plugins: {} },
        activationSourceConfig: { plugins: { allow: ["demo"] } },
        workspaceDir: "/workspace",
        env: { HOME: "/tmp/genesis-home" },
        onlyPluginIds: ["demo"],
        cache: false,
        activate: false,
        mode: "validate",
        loadModules: undefined,
      }),
    );
  });

  it("forwards explicit manifest-only requests", () => {
    loadPluginMetadataRegistrySnapshot({
      config: { plugins: {} },
      loadModules: false,
    });

    expect(loadGenesisPluginsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        loadModules: false,
        mode: "validate",
      }),
    );
  });

  it("forwards an explicit logger through metadata snapshots", () => {
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    loadPluginMetadataRegistrySnapshot({
      config: { plugins: {} },
      logger,
      workspaceDir: "/workspace",
    });

    expect(loadGenesisPluginsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        config: { plugins: {} },
        logger,
        workspaceDir: "/workspace",
        mode: "validate",
      }),
    );
  });

  it("preserves explicit empty plugin scopes on metadata snapshots", () => {
    loadPluginMetadataRegistrySnapshot({
      config: { plugins: {} },
      onlyPluginIds: [],
    });

    expect(loadGenesisPluginsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        onlyPluginIds: [],
        mode: "validate",
      }),
    );
  });
});
