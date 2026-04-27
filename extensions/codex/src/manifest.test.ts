import fs from "node:fs";
import { describe, expect, it } from "vitest";

type CodexPackageManifest = {
  dependencies?: Record<string, string>;
  genesis?: {
    bundle?: {
      stageRuntimeDependencies?: boolean;
    };
  };
};

describe("codex package manifest", () => {
  it("opts into staging bundled runtime dependencies", () => {
    const packageJson = JSON.parse(
      fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as CodexPackageManifest;

    expect(packageJson.dependencies?.["@mariozechner/pi-coding-agent"]).toBeDefined();
    expect(packageJson.genesis?.bundle?.stageRuntimeDependencies).toBe(true);
  });
});
