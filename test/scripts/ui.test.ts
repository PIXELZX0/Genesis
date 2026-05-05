import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertSafeWindowsShellArgs,
  resolveDirectNodeExecPath,
  resolveDirectScriptSpawnSpec,
  shouldUseShellForCommand,
} from "../../scripts/ui.js";

describe("scripts/ui windows spawn behavior", () => {
  it("enables shell for Windows command launchers that require cmd.exe", () => {
    expect(
      shouldUseShellForCommand("C:\\Users\\dev\\AppData\\Local\\pnpm\\pnpm.CMD", "win32"),
    ).toBe(true);
    expect(shouldUseShellForCommand("C:\\tools\\pnpm.bat", "win32")).toBe(true);
  });

  it("does not enable shell for non-shell launchers", () => {
    expect(shouldUseShellForCommand("C:\\Program Files\\nodejs\\node.exe", "win32")).toBe(false);
    expect(shouldUseShellForCommand("/usr/local/bin/pnpm", "linux")).toBe(false);
  });

  it("allows safe forwarded args when shell mode is required on Windows", () => {
    expect(() =>
      assertSafeWindowsShellArgs(["run", "build", "--filter", "@genesis/ui"], "win32"),
    ).not.toThrow();
  });

  it("rejects dangerous forwarded args when shell mode is required on Windows", () => {
    expect(() => assertSafeWindowsShellArgs(["run", "build", "evil&calc"], "win32")).toThrow(
      /unsafe windows shell argument/i,
    );
    expect(() => assertSafeWindowsShellArgs(["run", "build", "%PATH%"], "win32")).toThrow(
      /unsafe windows shell argument/i,
    );
  });

  it("does not reject args on non-windows platforms", () => {
    expect(() => assertSafeWindowsShellArgs(["contains&metacharacters"], "linux")).not.toThrow();
  });

  it("prefers an external Node when the current process is app-bundled on macOS", () => {
    expect(
      resolveDirectNodeExecPath({
        env: { PATH: "/opt/homebrew/bin" },
        existsSync: (candidate: string) =>
          candidate === "/Applications/Codex.app/Contents/Resources/node" ||
          candidate === "/opt/homebrew/bin/node",
        nodeExecPath: "/Applications/Codex.app/Contents/Resources/node",
        platform: "darwin",
      }),
    ).toBe("/opt/homebrew/bin/node");
  });

  it("honors an explicit UI Node override", () => {
    expect(
      resolveDirectNodeExecPath({
        env: { GENESIS_UI_NODE: "/custom/node", PATH: "/opt/homebrew/bin" },
        existsSync: (candidate: string) =>
          candidate === "/custom/node" || candidate === "/opt/homebrew/bin/node",
        nodeExecPath: "/Applications/Codex.app/Contents/Resources/node",
        platform: "darwin",
      }),
    ).toBe("/custom/node");
  });

  it("runs installed Vite directly when no package runner is available", () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "genesis-ui-script-"));
    mkdirSync(path.join(tempDir, "vite"), { recursive: true });
    const vitePackageJson = path.join(tempDir, "vite", "package.json");
    writeFileSync(vitePackageJson, JSON.stringify({ bin: { vite: "bin/vite.js" } }), "utf8");

    try {
      expect(
        resolveDirectScriptSpawnSpec("dev", ["--host", "127.0.0.1"], {
          nodeExecPath: "/node",
          requireResolve: (id: string) => {
            if (id === "vite/package.json") {
              return vitePackageJson;
            }
            throw new Error(`unexpected package: ${id}`);
          },
        }),
      ).toEqual({
        cmd: "/node",
        args: [path.join(tempDir, "vite", "bin", "vite.js"), "--host", "127.0.0.1"],
      });
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("matches the UI test package script when launching Vitest directly", () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "genesis-ui-script-"));
    mkdirSync(path.join(tempDir, "vitest"), { recursive: true });
    const vitestPackageJson = path.join(tempDir, "vitest", "package.json");
    writeFileSync(vitestPackageJson, JSON.stringify({ bin: { vitest: "vitest.mjs" } }), "utf8");

    try {
      expect(
        resolveDirectScriptSpawnSpec("test", ["--runInBand"], {
          nodeExecPath: "/node",
          requireResolve: (id: string) => {
            if (id === "vitest/package.json") {
              return vitestPackageJson;
            }
            throw new Error(`unexpected package: ${id}`);
          },
        }),
      ).toEqual({
        cmd: "/node",
        args: [
          path.join(tempDir, "vitest", "vitest.mjs"),
          "run",
          "--config",
          "vitest.config.ts",
          "--runInBand",
        ],
      });
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
