import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanupTempDirs, makeTempDir } from "../test/helpers/temp-dir.js";

const tempRoots: string[] = [];

function withFakeCli(versionOutput: string): { root: string; cliPath: string } {
  const root = makeTempDir(tempRoots, "genesis-install-sh-");
  const cliPath = path.join(root, "genesis");
  const escapedOutput = versionOutput.replace(/'/g, "'\\''");
  fs.writeFileSync(
    cliPath,
    `#!/bin/sh
printf '%s\n' '${escapedOutput}'
`,
    "utf-8",
  );
  fs.chmodSync(cliPath, 0o755);
  return { root, cliPath };
}

function resolveInstallerVersionCases(params: {
  cliPaths: string[];
  stdinCliPath: string;
  stdinCwd: string;
}): string[] {
  const installerPath = path.join(process.cwd(), "scripts", "install.sh");
  const installerSource = fs.readFileSync(installerPath, "utf-8");
  const versionHelperStart = installerSource.indexOf("load_install_version_helpers() {");
  const versionHelperEnd = installerSource.indexOf("\nis_gateway_daemon_loaded() {");
  if (versionHelperStart < 0 || versionHelperEnd < 0) {
    throw new Error("install.sh version helper block not found");
  }
  const versionHelperSource = installerSource.slice(versionHelperStart, versionHelperEnd);
  const output = execFileSync(
    "bash",
    [
      "-c",
      `${versionHelperSource}
for genesis_bin in "\${@:3}"; do
  GENESIS_BIN="$genesis_bin"
  resolve_genesis_version
done
(
  cd "$2"
  FAKE_GENESIS_BIN="\${@:1:1}" bash -s <<'GENESIS_STDIN_INSTALLER'
${versionHelperSource}
GENESIS_BIN="$FAKE_GENESIS_BIN"
resolve_genesis_version
GENESIS_STDIN_INSTALLER
)`,
      "genesis-version-test",
      params.stdinCliPath,
      params.stdinCwd,
      ...params.cliPaths,
    ],
    {
      cwd: process.cwd(),
      encoding: "utf-8",
      env: {
        ...process.env,
        GENESIS_INSTALL_SH_NO_RUN: "1",
      },
    },
  );
  return output.trimEnd().split("\n");
}

describe("install.sh version resolution", () => {
  afterEach(() => {
    cleanupTempDirs(tempRoots);
  });

  it.runIf(process.platform !== "win32")(
    "parses CLI versions and keeps stdin helpers isolated from cwd",
    () => {
      const decorated = withFakeCli("Genesis 2026.3.10 (abcdef0)");
      const raw = withFakeCli("Genesis dev's build");
      const stdinFixture = withFakeCli("Genesis 2026.3.10 (abcdef0)");

      const hostileCwd = makeTempDir(tempRoots, "genesis-install-stdin-");
      const hostileHelper = path.join(
        hostileCwd,
        "docker",
        "install-sh-common",
        "version-parse.sh",
      );
      fs.mkdirSync(path.dirname(hostileHelper), { recursive: true });
      fs.writeFileSync(
        hostileHelper,
        `#!/usr/bin/env bash
extract_genesis_semver() {
  printf '%s' 'poisoned'
}
`,
        "utf-8",
      );

      expect(
        resolveInstallerVersionCases({
          cliPaths: [decorated.cliPath, raw.cliPath],
          stdinCliPath: stdinFixture.cliPath,
          stdinCwd: hostileCwd,
        }),
      ).toEqual(["2026.3.10", "Genesis dev's build", "2026.3.10"]);
    },
  );
});
