import { describe, expect, it } from "vitest";
import {
  EXTERNAL_CODE_PLUGIN_REQUIRED_FIELD_PATHS,
  listMissingExternalCodePluginFieldPaths,
  normalizeExternalPluginCompatibility,
  validateExternalCodePluginPackageJson,
} from "./index.js";

describe("@genesis/plugin-package-contract", () => {
  it("normalizes the Genesis compatibility block for external plugins", () => {
    expect(
      normalizeExternalPluginCompatibility({
        version: "1.2.3",
        genesis: {
          compat: {
            pluginApi: ">=2026.3.24-beta.2",
            minGatewayVersion: "2026.3.24-beta.2",
          },
          build: {
            genesisVersion: "2026.3.24-beta.2",
            pluginSdkVersion: "0.9.0",
          },
        },
      }),
    ).toEqual({
      pluginApiRange: ">=2026.3.24-beta.2",
      builtWithGenesisVersion: "2026.3.24-beta.2",
      pluginSdkVersion: "0.9.0",
      minGatewayVersion: "2026.3.24-beta.2",
    });
  });

  it("falls back to install.minHostVersion and package version when compatible", () => {
    expect(
      normalizeExternalPluginCompatibility({
        version: "1.2.3",
        genesis: {
          compat: {
            pluginApi: ">=1.0.0",
          },
          install: {
            minHostVersion: "2026.3.24-beta.2",
          },
        },
      }),
    ).toEqual({
      pluginApiRange: ">=1.0.0",
      builtWithGenesisVersion: "1.2.3",
      minGatewayVersion: "2026.3.24-beta.2",
    });
  });

  it("lists the required external code-plugin fields", () => {
    expect(EXTERNAL_CODE_PLUGIN_REQUIRED_FIELD_PATHS).toEqual([
      "genesis.compat.pluginApi",
      "genesis.build.genesisVersion",
    ]);
  });

  it("reports missing required fields with stable field paths", () => {
    const packageJson = {
      genesis: {
        compat: {},
        build: {},
      },
    };

    expect(listMissingExternalCodePluginFieldPaths(packageJson)).toEqual([
      "genesis.compat.pluginApi",
      "genesis.build.genesisVersion",
    ]);
    expect(validateExternalCodePluginPackageJson(packageJson).issues).toEqual([
      {
        fieldPath: "genesis.compat.pluginApi",
        message:
          "genesis.compat.pluginApi is required for external code plugins published to ClawHub.",
      },
      {
        fieldPath: "genesis.build.genesisVersion",
        message:
          "genesis.build.genesisVersion is required for external code plugins published to ClawHub.",
      },
    ]);
  });
});
