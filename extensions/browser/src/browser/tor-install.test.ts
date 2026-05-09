import type {
  PluginCommandRunOptions,
  PluginCommandRunResult,
} from "genesis/plugin-sdk/run-command";
import { describe, expect, it, vi } from "vitest";
import type { ResolvedBrowserTorConfig } from "./config.js";
import { resolveManagedTorExecutable, type TorAutoInstallDeps } from "./tor-install.js";

function baseTor(overrides: Partial<ResolvedBrowserTorConfig> = {}): ResolvedBrowserTorConfig {
  return {
    enabled: true,
    mode: "managed",
    routeMode: "onion-only",
    socksHost: "127.0.0.1",
    socksPort: 18900,
    extraArgs: [],
    ...overrides,
  };
}

function commandResult(overrides: Partial<PluginCommandRunResult> = {}): PluginCommandRunResult {
  return {
    code: 0,
    stdout: "",
    stderr: "",
    ...overrides,
  };
}

describe("browser managed Tor executable resolution", () => {
  it("uses an explicit configured executable without auto-installing", async () => {
    const runCommand = vi.fn<NonNullable<TorAutoInstallDeps["runCommand"]>>();
    const detectBinary = vi.fn(async (name: string) => name === "/opt/tor/bin/tor");

    await expect(
      resolveManagedTorExecutable(baseTor({ executablePath: "/opt/tor/bin/tor" }), {
        detectBinary,
        runCommand,
      }),
    ).resolves.toEqual({
      executablePath: "/opt/tor/bin/tor",
      installed: false,
    });
    expect(runCommand).not.toHaveBeenCalled();
  });

  it("does not replace a missing explicit executable with an auto-installed Tor", async () => {
    const runCommand = vi.fn<NonNullable<TorAutoInstallDeps["runCommand"]>>();

    await expect(
      resolveManagedTorExecutable(baseTor({ executablePath: "/missing/tor" }), {
        detectBinary: async () => false,
        runCommand,
      }),
    ).rejects.toThrow(/Configured Tor executable was not found/);
    expect(runCommand).not.toHaveBeenCalled();
  });

  it("treats executablePath=tor like the default and still auto-installs when missing", async () => {
    let installed = false;
    const runCommand = vi.fn(async (options: PluginCommandRunOptions) => {
      if (options.argv.join(" ") === "/opt/homebrew/bin/brew install tor") {
        installed = true;
        return commandResult();
      }
      if (options.argv[1] === "--prefix") {
        return commandResult({ code: 1, stderr: "not installed" });
      }
      return commandResult({ code: 1, stderr: `unexpected command: ${options.argv.join(" ")}` });
    });

    await expect(
      resolveManagedTorExecutable(baseTor({ executablePath: "tor" }), {
        platform: "darwin",
        detectBinary: async (name) => name === "tor" && installed,
        resolveBrewExecutable: () => "/opt/homebrew/bin/brew",
        accessSync: () => {
          throw new Error("ENOENT");
        },
        runCommand,
      }),
    ).resolves.toEqual({
      executablePath: "tor",
      installed: true,
      installLabel: "Homebrew",
    });
  });

  it("installs Tor with Homebrew on macOS when tor is missing", async () => {
    let installed = false;
    const runCommand = vi.fn(async (options: PluginCommandRunOptions) => {
      if (options.argv[1] === "--prefix") {
        return commandResult({
          code: installed ? 0 : 1,
          stdout: installed ? "/opt/homebrew/opt/tor\n" : "",
          stderr: installed ? "" : "not installed",
        });
      }
      if (options.argv.join(" ") === "/opt/homebrew/bin/brew install tor") {
        installed = true;
        return commandResult();
      }
      return commandResult({ code: 1, stderr: `unexpected command: ${options.argv.join(" ")}` });
    });

    await expect(
      resolveManagedTorExecutable(baseTor(), {
        platform: "darwin",
        detectBinary: async (name) => name === "tor" && installed,
        resolveBrewExecutable: () => "/opt/homebrew/bin/brew",
        accessSync: (filePath) => {
          if (installed && String(filePath) === "/opt/homebrew/opt/tor/bin/tor") {
            return;
          }
          throw new Error("ENOENT");
        },
        runCommand,
      }),
    ).resolves.toEqual({
      executablePath: "tor",
      installed: true,
      installLabel: "Homebrew",
    });

    expect(runCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        argv: ["/opt/homebrew/bin/brew", "install", "tor"],
        timeoutMs: 15 * 60_000,
      }),
    );
  });

  it("installs Tor through apt-get with non-interactive sudo on Linux", async () => {
    let installed = false;
    const detectBinary = vi.fn(async (name: string) => {
      if (name === "tor") {
        return installed;
      }
      if (name === "apt-get" || name === "sudo") {
        return true;
      }
      return false;
    });
    const runCommand = vi.fn(async (options: PluginCommandRunOptions) => {
      if (options.argv.join(" ") === "sudo -n apt-get install -y tor") {
        installed = true;
        return commandResult();
      }
      return commandResult({ code: 1, stderr: `unexpected command: ${options.argv.join(" ")}` });
    });

    await expect(
      resolveManagedTorExecutable(baseTor(), {
        platform: "linux",
        getUid: () => 501,
        detectBinary,
        resolveBrewExecutable: () => undefined,
        accessSync: () => {
          throw new Error("ENOENT");
        },
        runCommand,
      }),
    ).resolves.toEqual({
      executablePath: "tor",
      installed: true,
      installLabel: "apt-get",
    });

    expect(runCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        argv: ["sudo", "-n", "apt-get", "install", "-y", "tor"],
        timeoutMs: 15 * 60_000,
      }),
    );
  });

  it("reports a manual install hint when no automatic installer is available", async () => {
    await expect(
      resolveManagedTorExecutable(baseTor(), {
        platform: "win32",
        detectBinary: async () => false,
        resolveBrewExecutable: () => undefined,
        accessSync: () => {
          throw new Error("ENOENT");
        },
        runCommand: async () => commandResult(),
      }),
    ).rejects.toThrow(/Tor Expert Bundle/);
  });
});
