import {
  runPluginCommandWithTimeout,
  type PluginCommandRunOptions,
  type PluginCommandRunResult,
} from "../runtime-api.js";
import type { ResolvedOrcaIdeConfig } from "./config.js";

export class OrcaCliError extends Error {
  readonly code: number;
  constructor(message: string, code: number) {
    super(message);
    this.name = "OrcaCliError";
    this.code = code;
  }
}

export type OrcaCliDeps = {
  runCommand?: (options: PluginCommandRunOptions) => Promise<PluginCommandRunResult>;
  env?: NodeJS.ProcessEnv;
};

/** Resolution order: ORCA_CLI_COMMAND env (Orca-managed sessions set this) > config.command > "orca". */
export function resolveOrcaCommand(
  config: Pick<ResolvedOrcaIdeConfig, "command">,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return env.ORCA_CLI_COMMAND?.trim() || config.command || "orca";
}

function isMissingBinaryError(stderr: string): boolean {
  const normalized = stderr.toLowerCase();
  return (
    normalized.includes("enoent") ||
    normalized.includes("command not found") ||
    normalized.includes("not recognized as an internal or external command")
  );
}

export function buildOrcaArgv(params: { config: ResolvedOrcaIdeConfig; args: string[] }): string[] {
  const command = resolveOrcaCommand(params.config);
  const argv = [command, ...params.args, "--json"];
  if (params.config.environment) {
    argv.push("--environment", params.config.environment);
  }
  if (params.config.pairingCode) {
    argv.push("--pairing-code", params.config.pairingCode);
  }
  return argv;
}

/**
 * Run one `orca` CLI invocation and parse its JSON stdout. Stateless per call —
 * there is no persistent session, matching how the `orca` CLI itself behaves
 * as a stateless client against the running Orca app/runtime.
 */
export async function runOrca(
  params: { config: ResolvedOrcaIdeConfig; args: string[]; timeoutMs?: number },
  deps: OrcaCliDeps = {},
): Promise<unknown> {
  const env = deps.env ?? process.env;
  const runCommand = deps.runCommand ?? runPluginCommandWithTimeout;
  const command = resolveOrcaCommand(params.config, env);
  const argv = buildOrcaArgv(params);

  const result = await runCommand({
    argv,
    timeoutMs: params.timeoutMs ?? params.config.timeoutMs,
    env,
  });

  if (result.code !== 0) {
    const stderr = result.stderr.trim();
    if (isMissingBinaryError(stderr)) {
      throw new OrcaCliError(
        `orca CLI binary "${command}" was not found. Install Orca IDE and ensure "${command}" is on PATH, or set orca-ide.command / ORCA_CLI_COMMAND. On Linux outside an Orca-managed terminal, bare "orca" is the GNOME screen reader — use "orca-ide" instead.`,
        result.code,
      );
    }
    throw new OrcaCliError(stderr || `orca ${params.args[0] ?? ""} failed`, result.code);
  }

  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new OrcaCliError(
      `orca ${params.args.join(" ")} did not return valid JSON: ${result.stdout.slice(0, 500)}`,
      result.code,
    );
  }
}
