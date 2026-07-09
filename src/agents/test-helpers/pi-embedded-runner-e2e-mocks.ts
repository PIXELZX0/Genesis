import { vi } from "vitest";

export function installEmbeddedRunnerBaseE2eMocks(options?: {
  hookRunner?: "minimal" | "full";
}): void {
  vi.doMock("../../plugins/hook-runner-global.js", () =>
    options?.hookRunner === "full"
      ? {
          getGlobalHookRunner: vi.fn(() => undefined),
          getGlobalPluginRegistry: vi.fn(() => null),
          hasGlobalHooks: vi.fn(() => false),
          initializeGlobalHookRunner: vi.fn(),
          resetGlobalHookRunner: vi.fn(),
        }
      : {
          getGlobalHookRunner: vi.fn(() => undefined),
        },
  );
  vi.doMock("../../context-engine/init.js", () => ({
    ensureContextEnginesInitialized: vi.fn(),
  }));
  vi.doMock("../../context-engine/registry.js", () => ({
    resolveContextEngine: vi.fn(async () => ({
      dispose: async () => undefined,
    })),
  }));
  vi.doMock("../runtime-plugins.js", () => ({
    ensureRuntimePluginsLoaded: vi.fn(),
  }));
  // Provider hook lookups (resolveProviderAuthProfileId, prepareExtraParams,
  // etc.) resolve real bundled provider plugins by default, which can shell
  // out to a real synchronous `npm install` for a plugin's missing runtime
  // deps (ensureBundledPluginRuntimeDeps -> spawnSync) and hang the event
  // loop for the whole e2e run. Keep provider-hook resolution empty here.
  vi.doMock("../../plugins/providers.runtime.js", () => ({
    resolvePluginProviders: vi.fn(() => []),
    isPluginProvidersLoadInFlight: vi.fn(() => false),
  }));
}
