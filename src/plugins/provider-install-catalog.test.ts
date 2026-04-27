import { beforeEach, describe, expect, it, vi } from "vitest";

type DiscoverGenesisPlugins = typeof import("./discovery.js").discoverGenesisPlugins;
type LoadPluginManifest = typeof import("./manifest.js").loadPluginManifest;
type ResolveManifestProviderAuthChoices =
  typeof import("./provider-auth-choices.js").resolveManifestProviderAuthChoices;

const discoverGenesisPlugins = vi.hoisted(() =>
  vi.fn<DiscoverGenesisPlugins>(() => ({ candidates: [], diagnostics: [] })),
);
vi.mock("./discovery.js", () => ({
  discoverGenesisPlugins,
}));

const loadPluginManifest = vi.hoisted(() => vi.fn<LoadPluginManifest>());
vi.mock("./manifest.js", async () => {
  const actual = await vi.importActual<typeof import("./manifest.js")>("./manifest.js");
  return {
    ...actual,
    loadPluginManifest,
  };
});

const resolveManifestProviderAuthChoices = vi.hoisted(() =>
  vi.fn<ResolveManifestProviderAuthChoices>(() => []),
);
vi.mock("./provider-auth-choices.js", () => ({
  resolveManifestProviderAuthChoices,
}));

import {
  resolveProviderInstallCatalogEntries,
  resolveProviderInstallCatalogEntry,
} from "./provider-install-catalog.js";

describe("provider install catalog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    discoverGenesisPlugins.mockReturnValue({
      candidates: [],
      diagnostics: [],
    });
    resolveManifestProviderAuthChoices.mockReturnValue([]);
  });

  it("merges manifest auth-choice metadata with discovery install metadata", () => {
    discoverGenesisPlugins.mockReturnValue({
      candidates: [
        {
          idHint: "openai",
          origin: "bundled",
          rootDir: "/repo/extensions/openai",
          source: "/repo/extensions/openai/index.ts",
          workspaceDir: "/repo",
          packageName: "@genesis/openai",
          packageDir: "/repo/extensions/openai",
          packageManifest: {
            install: {
              npmSpec: "@genesis/openai@1.2.3",
              defaultChoice: "npm",
              expectedIntegrity: "sha512-openai",
            },
          },
        },
      ],
      diagnostics: [],
    });
    loadPluginManifest.mockReturnValue({
      ok: true,
      manifestPath: "/repo/extensions/openai/genesis.plugin.json",
      manifest: {
        id: "openai",
        configSchema: {
          type: "object",
        },
      },
    });
    resolveManifestProviderAuthChoices.mockReturnValue([
      {
        pluginId: "openai",
        providerId: "openai",
        methodId: "api-key",
        choiceId: "openai-api-key",
        choiceLabel: "OpenAI API key",
        groupId: "openai",
        groupLabel: "OpenAI",
      },
    ]);

    expect(resolveProviderInstallCatalogEntries()).toEqual([
      {
        pluginId: "openai",
        providerId: "openai",
        methodId: "api-key",
        choiceId: "openai-api-key",
        choiceLabel: "OpenAI API key",
        groupId: "openai",
        groupLabel: "OpenAI",
        label: "OpenAI",
        origin: "bundled",
        install: {
          npmSpec: "@genesis/openai@1.2.3",
          localPath: "extensions/openai",
          defaultChoice: "npm",
          expectedIntegrity: "sha512-openai",
        },
        installSource: {
          defaultChoice: "npm",
          npm: {
            spec: "@genesis/openai@1.2.3",
            packageName: "@genesis/openai",
            selector: "1.2.3",
            selectorKind: "exact-version",
            exactVersion: true,
            expectedIntegrity: "sha512-openai",
            pinState: "exact-with-integrity",
          },
          local: {
            path: "extensions/openai",
          },
          warnings: [],
        },
      },
    ]);
  });

  it("falls back to workspace-relative local path when install metadata is sparse", () => {
    discoverGenesisPlugins.mockReturnValue({
      candidates: [
        {
          idHint: "demo-provider",
          origin: "workspace",
          rootDir: "/repo/extensions/demo-provider",
          source: "/repo/extensions/demo-provider/index.ts",
          workspaceDir: "/repo",
          packageName: "@vendor/demo-provider",
          packageDir: "/repo/extensions/demo-provider",
          packageManifest: {},
        },
      ],
      diagnostics: [],
    });
    loadPluginManifest.mockReturnValue({
      ok: true,
      manifestPath: "/repo/extensions/demo-provider/genesis.plugin.json",
      manifest: {
        id: "demo-provider",
        configSchema: {
          type: "object",
        },
      },
    });
    resolveManifestProviderAuthChoices.mockReturnValue([
      {
        pluginId: "demo-provider",
        providerId: "demo-provider",
        methodId: "api-key",
        choiceId: "demo-provider-api-key",
        choiceLabel: "Demo Provider API key",
      },
    ]);

    expect(resolveProviderInstallCatalogEntries()).toEqual([
      {
        pluginId: "demo-provider",
        providerId: "demo-provider",
        methodId: "api-key",
        choiceId: "demo-provider-api-key",
        choiceLabel: "Demo Provider API key",
        label: "Demo Provider API key",
        origin: "workspace",
        install: {
          localPath: "extensions/demo-provider",
          defaultChoice: "local",
        },
        installSource: {
          defaultChoice: "local",
          local: {
            path: "extensions/demo-provider",
          },
          warnings: [],
        },
      },
    ]);
  });

  it("resolves one installable auth choice by id", () => {
    discoverGenesisPlugins.mockReturnValue({
      candidates: [
        {
          idHint: "vllm",
          origin: "config",
          rootDir: "/Users/test/.genesis/extensions/vllm",
          source: "/Users/test/.genesis/extensions/vllm/index.js",
          packageName: "@genesis/vllm",
          packageDir: "/Users/test/.genesis/extensions/vllm",
          packageManifest: {
            install: {
              npmSpec: "@genesis/vllm@2.0.0",
              expectedIntegrity: "sha512-vllm",
            },
          },
        },
      ],
      diagnostics: [],
    });
    loadPluginManifest.mockReturnValue({
      ok: true,
      manifestPath: "/Users/test/.genesis/extensions/vllm/genesis.plugin.json",
      manifest: {
        id: "vllm",
        configSchema: {
          type: "object",
        },
      },
    });
    resolveManifestProviderAuthChoices.mockReturnValue([
      {
        pluginId: "vllm",
        providerId: "vllm",
        methodId: "server",
        choiceId: "vllm",
        choiceLabel: "vLLM",
        groupLabel: "vLLM",
      },
    ]);

    expect(resolveProviderInstallCatalogEntry("vllm")).toEqual({
      pluginId: "vllm",
      providerId: "vllm",
      methodId: "server",
      choiceId: "vllm",
      choiceLabel: "vLLM",
      groupLabel: "vLLM",
      label: "vLLM",
      origin: "config",
      install: {
        npmSpec: "@genesis/vllm@2.0.0",
        expectedIntegrity: "sha512-vllm",
        defaultChoice: "npm",
      },
      installSource: {
        defaultChoice: "npm",
        npm: {
          spec: "@genesis/vllm@2.0.0",
          packageName: "@genesis/vllm",
          selector: "2.0.0",
          selectorKind: "exact-version",
          exactVersion: true,
          expectedIntegrity: "sha512-vllm",
          pinState: "exact-with-integrity",
        },
        warnings: [],
      },
    });
  });

  it("exposes trusted registry npm specs without requiring an exact version or integrity pin", () => {
    discoverGenesisPlugins.mockReturnValue({
      candidates: [
        {
          idHint: "vllm",
          origin: "config",
          rootDir: "/Users/test/.genesis/extensions/vllm",
          source: "/Users/test/.genesis/extensions/vllm/index.js",
          packageName: "@genesis/vllm",
          packageDir: "/Users/test/.genesis/extensions/vllm",
          packageManifest: {
            install: {
              npmSpec: "@genesis/vllm",
            },
          },
        },
      ],
      diagnostics: [],
    });
    loadPluginManifest.mockReturnValue({
      ok: true,
      manifestPath: "/Users/test/.genesis/extensions/vllm/genesis.plugin.json",
      manifest: {
        id: "vllm",
        configSchema: {
          type: "object",
        },
      },
    });
    resolveManifestProviderAuthChoices.mockReturnValue([
      {
        pluginId: "vllm",
        providerId: "vllm",
        methodId: "server",
        choiceId: "vllm",
        choiceLabel: "vLLM",
      },
    ]);

    expect(resolveProviderInstallCatalogEntry("vllm")).toEqual({
      pluginId: "vllm",
      providerId: "vllm",
      methodId: "server",
      choiceId: "vllm",
      choiceLabel: "vLLM",
      label: "vLLM",
      origin: "config",
      install: {
        npmSpec: "@genesis/vllm",
        defaultChoice: "npm",
      },
      installSource: {
        defaultChoice: "npm",
        npm: {
          spec: "@genesis/vllm",
          packageName: "@genesis/vllm",
          selectorKind: "none",
          exactVersion: false,
          pinState: "floating-without-integrity",
        },
        warnings: ["npm-spec-floating", "npm-spec-missing-integrity"],
      },
    });
  });

  it("warns when provider install npmSpec drifts from package identity", () => {
    discoverGenesisPlugins.mockReturnValue({
      candidates: [
        {
          idHint: "vllm",
          origin: "config",
          rootDir: "/Users/test/.genesis/extensions/vllm",
          source: "/Users/test/.genesis/extensions/vllm/index.js",
          packageName: "@genesis/vllm",
          packageDir: "/Users/test/.genesis/extensions/vllm",
          packageManifest: {
            install: {
              npmSpec: "@genesis/vllm-fork@2.0.0",
              expectedIntegrity: "sha512-vllm",
            },
          },
        },
      ],
      diagnostics: [],
    });
    loadPluginManifest.mockReturnValue({
      ok: true,
      manifestPath: "/Users/test/.genesis/extensions/vllm/genesis.plugin.json",
      manifest: {
        id: "vllm",
        configSchema: {
          type: "object",
        },
      },
    });
    resolveManifestProviderAuthChoices.mockReturnValue([
      {
        pluginId: "vllm",
        providerId: "vllm",
        methodId: "server",
        choiceId: "vllm",
        choiceLabel: "vLLM",
      },
    ]);

    expect(resolveProviderInstallCatalogEntry("vllm")?.installSource).toEqual({
      defaultChoice: "npm",
      npm: {
        spec: "@genesis/vllm-fork@2.0.0",
        packageName: "@genesis/vllm-fork",
        expectedPackageName: "@genesis/vllm",
        selector: "2.0.0",
        selectorKind: "exact-version",
        exactVersion: true,
        expectedIntegrity: "sha512-vllm",
        pinState: "exact-with-integrity",
      },
      warnings: ["npm-spec-package-name-mismatch"],
    });
  });

  it("does not expose npm install specs from untrusted package metadata", () => {
    discoverGenesisPlugins.mockReturnValue({
      candidates: [
        {
          idHint: "demo-provider",
          origin: "global",
          rootDir: "/Users/test/.genesis/extensions/demo-provider",
          source: "/Users/test/.genesis/extensions/demo-provider/index.js",
          packageName: "@vendor/demo-provider",
          packageDir: "/Users/test/.genesis/extensions/demo-provider",
          packageManifest: {
            install: {
              npmSpec: "@vendor/demo-provider@1.2.3",
              expectedIntegrity: "sha512-demo",
            },
          },
        },
      ],
      diagnostics: [],
    });
    loadPluginManifest.mockReturnValue({
      ok: true,
      manifestPath: "/Users/test/.genesis/extensions/demo-provider/genesis.plugin.json",
      manifest: {
        id: "demo-provider",
        configSchema: {
          type: "object",
        },
      },
    });
    resolveManifestProviderAuthChoices.mockReturnValue([
      {
        pluginId: "demo-provider",
        providerId: "demo-provider",
        methodId: "api-key",
        choiceId: "demo-provider-api-key",
        choiceLabel: "Demo Provider API key",
      },
    ]);

    expect(resolveProviderInstallCatalogEntries()).toEqual([]);
  });

  it("skips untrusted workspace install candidates when requested", () => {
    discoverGenesisPlugins.mockReturnValue({
      candidates: [
        {
          idHint: "demo-provider",
          origin: "workspace",
          rootDir: "/repo/extensions/demo-provider",
          source: "/repo/extensions/demo-provider/index.ts",
          workspaceDir: "/repo",
          packageName: "@vendor/demo-provider",
          packageDir: "/repo/extensions/demo-provider",
          packageManifest: {
            install: {
              npmSpec: "@vendor/demo-provider",
            },
          },
        },
      ],
      diagnostics: [],
    });

    expect(
      resolveProviderInstallCatalogEntries({
        config: {
          plugins: {
            enabled: false,
          },
        },
        includeUntrustedWorkspacePlugins: false,
      }),
    ).toEqual([]);
    expect(loadPluginManifest).not.toHaveBeenCalled();
  });

  it("skips untrusted workspace candidates without id hints before manifest load", () => {
    discoverGenesisPlugins.mockReturnValue({
      candidates: [
        {
          idHint: "",
          origin: "workspace",
          rootDir: "/repo/extensions/demo-provider",
          source: "/repo/extensions/demo-provider/index.ts",
          workspaceDir: "/repo",
          packageName: "@vendor/demo-provider",
          packageDir: "/repo/extensions/demo-provider",
          packageManifest: {
            install: {
              npmSpec: "@vendor/demo-provider",
            },
          },
        },
      ],
      diagnostics: [],
    });

    expect(
      resolveProviderInstallCatalogEntries({ includeUntrustedWorkspacePlugins: false }),
    ).toEqual([]);
    expect(loadPluginManifest).not.toHaveBeenCalled();
  });
});
