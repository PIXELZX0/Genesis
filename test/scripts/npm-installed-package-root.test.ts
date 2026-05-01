import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  packageNameToInstallPathSegments,
  packageRootLooksInstalled,
  resolveInstalledPackageRoot,
} from "../../scripts/lib/npm-installed-package-root.mjs";

describe("scripts/lib/npm-installed-package-root", () => {
  it("resolves scoped npm package roots under a global node_modules root", () => {
    expect(resolveInstalledPackageRoot("/tmp/prefix/lib/node_modules", "@pixelzx/genesis")).toBe(
      path.join("/tmp/prefix/lib/node_modules", "@pixelzx", "genesis"),
    );
  });

  it("keeps unscoped package root support for legacy install layouts", () => {
    expect(resolveInstalledPackageRoot("/tmp/prefix/lib/node_modules", "genesis")).toBe(
      path.join("/tmp/prefix/lib/node_modules", "genesis"),
    );
  });

  it("detects scoped package roots that already look globally installed", () => {
    expect(
      packageRootLooksInstalled(
        path.join("/tmp/prefix/lib/node_modules", "@pixelzx", "genesis"),
        "@pixelzx/genesis",
      ),
    ).toBe(true);
  });

  it("rejects invalid package names", () => {
    expect(() => packageNameToInstallPathSegments("@pixelzx")).toThrow(
      "scoped npm package name is invalid",
    );
    expect(() => packageNameToInstallPathSegments("")).toThrow(
      "npm package name must be a non-empty string.",
    );
  });
});
