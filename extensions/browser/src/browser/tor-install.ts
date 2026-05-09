import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  runPluginCommandWithTimeout,
  type PluginCommandRunOptions,
  type PluginCommandRunResult,
} from "genesis/plugin-sdk/run-command";
import { detectBinary, resolveBrewExecutable } from "genesis/plugin-sdk/setup-tools";
import type { ResolvedBrowserTorConfig } from "./config.js";

const TOR_INSTALL_TIMEOUT_MS = 15 * 60_000;
const TOR_PREFIX_TIMEOUT_MS = 10_000;
const TOR_INSTALL_OUTPUT_MAX_CHARS = 1_200;

export type ManagedTorExecutableResolution = {
  executablePath: string;
  installed: boolean;
  installLabel?: string;
};

export type TorAutoInstallDeps = {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  getUid?: () => number;
  homedir?: () => string;
  accessSync?: (filePath: fs.PathLike, mode?: number) => void;
  detectBinary?: (name: string) => Promise<boolean>;
  resolveBrewExecutable?: typeof resolveBrewExecutable;
  runCommand?: (options: PluginCommandRunOptions) => Promise<PluginCommandRunResult>;
};

type TorInstallPlan = {
  label: string;
  argv: string[];
  env?: NodeJS.ProcessEnv;
};

function getDeps(deps?: TorAutoInstallDeps): Required<TorAutoInstallDeps> {
  return {
    platform: deps?.platform ?? process.platform,
    env: deps?.env ?? process.env,
    getUid: deps?.getUid ?? (() => process.getuid?.() ?? -1),
    homedir: deps?.homedir ?? os.homedir,
    accessSync: deps?.accessSync ?? fs.accessSync,
    detectBinary: deps?.detectBinary ?? detectBinary,
    resolveBrewExecutable: deps?.resolveBrewExecutable ?? resolveBrewExecutable,
    runCommand: deps?.runCommand ?? runPluginCommandWithTimeout,
  };
}

function trimInstallOutput(value: string): string {
  const trimmed = value.trim();
  return trimmed.length > TOR_INSTALL_OUTPUT_MAX_CHARS
    ? `${trimmed.slice(0, TOR_INSTALL_OUTPUT_MAX_CHARS)}...`
    : trimmed;
}

function formatInstallFailure(plan: TorInstallPlan, result: PluginCommandRunResult): string {
  const output = trimInstallOutput(result.stderr || result.stdout);
  return `${plan.label} exited ${result.code}${output ? `: ${output}` : ""}`;
}

function isExecutable(filePath: string, accessSync: Required<TorAutoInstallDeps>["accessSync"]) {
  try {
    accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function commonTorExecutableCandidates(params: {
  brewExecutable?: string;
  homeDir: string;
  platform: NodeJS.Platform;
}): string[] {
  const brewBinDir =
    params.brewExecutable && path.isAbsolute(params.brewExecutable)
      ? path.dirname(params.brewExecutable)
      : undefined;
  const brewPrefix = brewBinDir ? path.dirname(brewBinDir) : undefined;
  const binaryName = params.platform === "win32" ? "tor.exe" : "tor";

  return unique([
    ...(brewBinDir ? [path.join(brewBinDir, binaryName)] : []),
    ...(brewPrefix ? [path.join(brewPrefix, "sbin", binaryName)] : []),
    path.join(params.homeDir, ".linuxbrew", "bin", binaryName),
    path.join(params.homeDir, ".linuxbrew", "sbin", binaryName),
    "/home/linuxbrew/.linuxbrew/bin/tor",
    "/home/linuxbrew/.linuxbrew/sbin/tor",
    "/opt/homebrew/bin/tor",
    "/opt/homebrew/sbin/tor",
    "/usr/local/bin/tor",
    "/usr/local/sbin/tor",
    "/usr/bin/tor",
  ]);
}

async function resolveAvailableBrewExecutable(
  deps: Required<TorAutoInstallDeps>,
): Promise<string | undefined> {
  const resolved = deps.resolveBrewExecutable({
    env: deps.env,
    homeDir: deps.homedir(),
  });
  if (resolved) {
    return resolved;
  }
  return (await deps.detectBinary("brew")) ? "brew" : undefined;
}

async function resolveBrewTorExecutable(
  brewExecutable: string,
  deps: Required<TorAutoInstallDeps>,
): Promise<string | null> {
  const result = await deps.runCommand({
    argv: [brewExecutable, "--prefix", "tor"],
    timeoutMs: TOR_PREFIX_TIMEOUT_MS,
    env: deps.env,
  });
  if (result.code !== 0) {
    return null;
  }
  const prefix = result.stdout.trim().split(/\r?\n/)[0]?.trim();
  if (!prefix) {
    return null;
  }
  const candidate = path.join(prefix, "bin", deps.platform === "win32" ? "tor.exe" : "tor");
  return isExecutable(candidate, deps.accessSync) ? candidate : null;
}

async function resolveExistingTorExecutable(
  deps: Required<TorAutoInstallDeps>,
): Promise<string | null> {
  if (await deps.detectBinary("tor")) {
    return "tor";
  }

  const brewExecutable = await resolveAvailableBrewExecutable(deps);
  if (brewExecutable) {
    const brewTorPath = await resolveBrewTorExecutable(brewExecutable, deps);
    if (brewTorPath) {
      return brewTorPath;
    }
  }

  for (const candidate of commonTorExecutableCandidates({
    brewExecutable,
    homeDir: deps.homedir(),
    platform: deps.platform,
  })) {
    if (isExecutable(candidate, deps.accessSync)) {
      return candidate;
    }
  }
  return null;
}

async function withLinuxPrivilege(
  argv: string[],
  deps: Required<TorAutoInstallDeps>,
): Promise<string[] | null> {
  if (deps.getUid() === 0) {
    return argv;
  }
  if (await deps.detectBinary("sudo")) {
    return ["sudo", "-n", ...argv];
  }
  return null;
}

async function addLinuxPackageManagerPlan(params: {
  plans: TorInstallPlan[];
  deps: Required<TorAutoInstallDeps>;
  binary: string;
  argv: string[];
  env?: NodeJS.ProcessEnv;
}) {
  if (!(await params.deps.detectBinary(params.binary))) {
    return;
  }
  const argv = await withLinuxPrivilege(params.argv, params.deps);
  if (!argv) {
    return;
  }
  params.plans.push({
    label: params.binary,
    argv,
    ...(params.env ? { env: params.env } : {}),
  });
}

async function buildTorInstallPlans(deps: Required<TorAutoInstallDeps>): Promise<TorInstallPlan[]> {
  const plans: TorInstallPlan[] = [];

  if (deps.platform === "darwin") {
    const brewExecutable = await resolveAvailableBrewExecutable(deps);
    if (brewExecutable) {
      plans.push({ label: "Homebrew", argv: [brewExecutable, "install", "tor"] });
    }
    return plans;
  }

  if (deps.platform === "linux") {
    const nonInteractiveEnv = { ...deps.env, DEBIAN_FRONTEND: "noninteractive" };
    await addLinuxPackageManagerPlan({
      plans,
      deps,
      binary: "apt-get",
      argv: ["apt-get", "install", "-y", "tor"],
      env: nonInteractiveEnv,
    });
    await addLinuxPackageManagerPlan({
      plans,
      deps,
      binary: "dnf",
      argv: ["dnf", "install", "-y", "tor"],
    });
    await addLinuxPackageManagerPlan({
      plans,
      deps,
      binary: "yum",
      argv: ["yum", "install", "-y", "tor"],
    });
    await addLinuxPackageManagerPlan({
      plans,
      deps,
      binary: "pacman",
      argv: ["pacman", "-Sy", "--noconfirm", "tor"],
    });
    await addLinuxPackageManagerPlan({
      plans,
      deps,
      binary: "apk",
      argv: ["apk", "add", "--no-cache", "tor"],
    });

    const brewExecutable = await resolveAvailableBrewExecutable(deps);
    if (brewExecutable) {
      plans.push({ label: "Homebrew", argv: [brewExecutable, "install", "tor"] });
    }
  }

  return plans;
}

function manualInstallHint(platform: NodeJS.Platform): string {
  if (platform === "darwin") {
    return "Install Tor with Homebrew (`brew install tor`) or set browser.tor.executablePath.";
  }
  if (platform === "linux") {
    return 'Install the tor package with your system package manager, set browser.tor.executablePath, or configure browser.tor.mode="external" for an existing SOCKS endpoint.';
  }
  if (platform === "win32") {
    return 'Install a Tor Expert Bundle and set browser.tor.executablePath, or configure browser.tor.mode="external" for an existing SOCKS endpoint.';
  }
  return 'Install Tor, set browser.tor.executablePath, or configure browser.tor.mode="external" for an existing SOCKS endpoint.';
}

async function autoInstallTor(
  deps: Required<TorAutoInstallDeps>,
): Promise<ManagedTorExecutableResolution> {
  const plans = await buildTorInstallPlans(deps);
  if (plans.length === 0) {
    throw new Error(
      `No supported automatic Tor installer is available on this host. ${manualInstallHint(
        deps.platform,
      )}`,
    );
  }

  const failures: string[] = [];
  for (const plan of plans) {
    const result = await deps.runCommand({
      argv: plan.argv,
      timeoutMs: TOR_INSTALL_TIMEOUT_MS,
      env: plan.env ?? deps.env,
    });
    if (result.code !== 0) {
      failures.push(formatInstallFailure(plan, result));
      continue;
    }

    const executablePath = await resolveExistingTorExecutable(deps);
    if (executablePath) {
      return {
        executablePath,
        installed: true,
        installLabel: plan.label,
      };
    }
    failures.push(`${plan.label} reported success, but the tor executable was not found.`);
  }

  throw new Error(
    `Automatic Tor installation failed. ${failures.join(" ")} ${manualInstallHint(deps.platform)}`,
  );
}

export async function resolveManagedTorExecutable(
  tor: Pick<ResolvedBrowserTorConfig, "executablePath">,
  depsInput?: TorAutoInstallDeps,
): Promise<ManagedTorExecutableResolution> {
  const deps = getDeps(depsInput);
  if (tor.executablePath && tor.executablePath !== "tor") {
    if (await deps.detectBinary(tor.executablePath)) {
      return { executablePath: tor.executablePath, installed: false };
    }
    throw new Error(
      `Configured Tor executable was not found: ${tor.executablePath}. Install Tor there or update browser.tor.executablePath.`,
    );
  }

  const existing = await resolveExistingTorExecutable(deps);
  if (existing) {
    return { executablePath: existing, installed: false };
  }

  return await autoInstallTor(deps);
}
