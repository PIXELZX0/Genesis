import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEmptyPluginRegistry } from "../plugins/registry-empty.js";
import { resetPluginRuntimeStateForTest, setActivePluginRegistry } from "../plugins/runtime.js";
import {
  ensureNodeHostPluginRegistry,
  invokeRegisteredNodeHostCommand,
  listRegisteredNodeHostCapsAndCommands,
} from "./plugin-node-host.js";

const manifestPlugins = vi.hoisted(() => ({
  value: [] as Array<{
    id: string;
    origin: string;
    workspaceDir?: string;
    activation?: { onCapabilities?: string[] };
  }>,
}));
const ensurePluginRegistryLoadedMock = vi.hoisted(() => vi.fn());

vi.mock("../plugins/manifest-registry.js", () => ({
  // Like discovery, workspace plugins only show up when their workspace is scanned.
  loadPluginManifestRegistry: (params?: { workspaceDir?: string }) => ({
    plugins: manifestPlugins.value
      .map((plugin) => ({
        providers: [],
        channels: [],
        cliBackends: [],
        skills: [],
        hooks: [],
        ...plugin,
      }))
      .filter((plugin) => !plugin.workspaceDir || plugin.workspaceDir === params?.workspaceDir),
    diagnostics: [],
  }),
}));

vi.mock("../plugins/runtime/runtime-registry-loader.js", async () => ({
  ensurePluginRegistryLoaded: ensurePluginRegistryLoadedMock,
  resolvePluginRuntimeLoadContext: (await import("../plugins/runtime/load-context.js"))
    .resolvePluginRuntimeLoadContext,
}));

afterEach(() => {
  resetPluginRuntimeStateForTest();
  manifestPlugins.value = [];
  ensurePluginRegistryLoadedMock.mockClear();
});

describe("plugin node-host registry", () => {
  it("lists plugin-declared caps and commands", () => {
    const registry = createEmptyPluginRegistry();
    registry.nodeHostCommands = [
      {
        pluginId: "browser",
        pluginName: "Browser",
        command: {
          command: "browser.proxy",
          cap: "browser",
          handle: vi.fn(async () => "{}"),
        },
        source: "test",
      },
      {
        pluginId: "photos",
        pluginName: "Photos",
        command: {
          command: "photos.proxy",
          cap: "photos",
          handle: vi.fn(async () => "{}"),
        },
        source: "test",
      },
      {
        pluginId: "browser-dup",
        pluginName: "Browser Dup",
        command: {
          command: "browser.inspect",
          cap: "browser",
          handle: vi.fn(async () => "{}"),
        },
        source: "test",
      },
    ];
    setActivePluginRegistry(registry);

    expect(listRegisteredNodeHostCapsAndCommands()).toEqual({
      caps: ["browser", "photos"],
      commands: ["browser.inspect", "browser.proxy", "photos.proxy"],
    });
  });

  it("dispatches plugin-declared node-host commands", async () => {
    const handle = vi.fn(async (paramsJSON?: string | null) => paramsJSON ?? "");
    const registry = createEmptyPluginRegistry();
    registry.nodeHostCommands = [
      {
        pluginId: "browser",
        pluginName: "Browser",
        command: {
          command: "browser.proxy",
          cap: "browser",
          handle,
        },
        source: "test",
      },
    ];
    setActivePluginRegistry(registry);

    await expect(invokeRegisteredNodeHostCommand("browser.proxy", '{"ok":true}')).resolves.toBe(
      '{"ok":true}',
    );
    await expect(invokeRegisteredNodeHostCommand("missing.command", null)).resolves.toBeNull();
    expect(handle).toHaveBeenCalledWith('{"ok":true}');
  });

  it("scopes node-host loading to hinted bundled plugins plus all external plugins", async () => {
    const workspaceDir = path.resolve("/node-host-workspace");
    manifestPlugins.value = [
      { id: "browser", origin: "bundled", activation: { onCapabilities: ["node-host"] } },
      { id: "anthropic", origin: "bundled" },
      { id: "telegram", origin: "bundled", activation: { onCapabilities: ["channel"] } },
      { id: "my-sensor", origin: "global" },
      { id: "workspace-tool", origin: "workspace", workspaceDir },
    ];

    await ensureNodeHostPluginRegistry({
      config: { agents: { defaults: { workspace: workspaceDir } } },
      env: {},
    });

    expect(ensurePluginRegistryLoadedMock).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceDir,
        onlyPluginIds: ["browser", "my-sensor", "workspace-tool"],
      }),
    );
  });
});
