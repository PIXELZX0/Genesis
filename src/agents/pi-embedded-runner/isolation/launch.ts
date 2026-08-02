import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isBunRuntime, isNodeRuntime } from "../../../daemon/runtime-binary.js";
import { resolveGenesisPackageRootSync } from "../../../infra/genesis-root.js";

export type PiIsolationChildLaunch = {
  command: string;
  args: string[];
  entryPath: string;
  source: boolean;
  tsconfigPath?: string;
};

const PI_ISOLATION_SPAWN_ENV_KEYS = [
  "ALL_PROXY",
  "COMSPEC",
  "HOME",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "LOGNAME",
  "NODE_ENV",
  "NODE_EXTRA_CA_CERTS",
  "NO_PROXY",
  "PATH",
  "PATHEXT",
  "SHELL",
  "SSL_CERT_DIR",
  "SSL_CERT_FILE",
  "SystemRoot",
  "TEMP",
  "TMP",
  "TMPDIR",
  "TZ",
  "USER",
  "VITEST",
  "WINDIR",
  "all_proxy",
  "http_proxy",
  "https_proxy",
  "no_proxy",
] as const;

const PI_ISOLATION_RUNTIME_ENV_KEYS = [
  "GENESIS_BUNDLED_PLUGINS_DIR",
  "GENESIS_CONFIG_PATH",
  "GENESIS_DISABLE_BUNDLED_PLUGINS",
  "GENESIS_DISABLE_PLUGIN_DISCOVERY_CACHE",
  "GENESIS_DISABLE_PLUGIN_MANIFEST_CACHE",
  "GENESIS_HOME",
  "GENESIS_PLUGIN_DISCOVERY_CACHE_MS",
  "GENESIS_PLUGIN_MANIFEST_CACHE_MS",
  "GENESIS_PLUGIN_STAGE_DIR",
  "GENESIS_PROFILE",
  "GENESIS_RAW_STREAM",
  "GENESIS_RAW_STREAM_PATH",
  "GENESIS_SESSION_MANAGER_CACHE_TTL_MS",
  "GENESIS_STATE_DIR",
] as const;

function copyEnvironmentKeys(
  env: NodeJS.ProcessEnv,
  keys: readonly string[],
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const key of keys) {
    const value = env[key];
    if (value !== undefined) {
      result[key] = value;
    }
  }
  return result;
}

export function createPiIsolationSpawnEnvironment(params?: {
  env?: NodeJS.ProcessEnv;
  tsconfigPath?: string;
}): NodeJS.ProcessEnv {
  return {
    ...copyEnvironmentKeys(params?.env ?? process.env, PI_ISOLATION_SPAWN_ENV_KEYS),
    GENESIS_PI_ISOLATION_CHILD: "1",
    ...(params?.tsconfigPath ? { TSX_TSCONFIG_PATH: params.tsconfigPath } : {}),
  };
}

export function createPiIsolationRuntimeEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  return copyEnvironmentKeys(env, PI_ISOLATION_RUNTIME_ENV_KEYS);
}

export function resolvePiIsolationChildLaunch(params?: {
  execPath?: string;
  moduleUrl?: string;
  cwd?: string;
  argv1?: string;
  existsSync?: (filePath: string) => boolean;
}): PiIsolationChildLaunch {
  const execPath = params?.execPath ?? process.execPath;
  const moduleUrl = params?.moduleUrl ?? import.meta.url;
  const existsSync = params?.existsSync ?? fs.existsSync;
  const packageRoot = resolveGenesisPackageRootSync({
    moduleUrl,
    cwd: params?.cwd ?? process.cwd(),
    argv1: params?.argv1 ?? process.argv[1],
  });
  if (!packageRoot) {
    throw new Error("Unable to locate the Genesis package root for the PI isolation child");
  }

  const sourceEntry = path.join(
    packageRoot,
    "src",
    "agents",
    "pi-embedded-runner",
    "isolation",
    "child.ts",
  );
  const builtEntry = path.join(packageRoot, "dist", "agents", "pi-isolated-child.js");
  const currentModulePath = fileURLToPath(moduleUrl);
  const runningFromSource = currentModulePath.includes(`${path.sep}src${path.sep}`);
  const source = runningFromSource && existsSync(sourceEntry);
  const entryPath = source ? sourceEntry : builtEntry;
  if (!existsSync(entryPath)) {
    throw new Error(`PI isolation child entrypoint is missing: ${entryPath}`);
  }
  if (isBunRuntime(execPath)) {
    return { command: execPath, args: [entryPath], entryPath, source };
  }
  if (!isNodeRuntime(execPath)) {
    throw new Error(`Unsupported runtime for PI isolation child: ${execPath}`);
  }
  const sourceLoader = source
    ? pathToFileURL(createRequire(moduleUrl).resolve("tsx")).href
    : undefined;
  return {
    command: execPath,
    args: source ? ["--import", sourceLoader as string, entryPath] : [entryPath],
    entryPath,
    source,
    ...(source ? { tsconfigPath: path.join(packageRoot, "tsconfig.json") } : {}),
  };
}
