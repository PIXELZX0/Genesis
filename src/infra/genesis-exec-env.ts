export const GENESIS_CLI_ENV_VAR = "GENESIS_CLI";
export const GENESIS_CLI_ENV_VALUE = "1";

export function markGenesisExecEnv<T extends Record<string, string | undefined>>(env: T): T {
  return {
    ...env,
    [GENESIS_CLI_ENV_VAR]: GENESIS_CLI_ENV_VALUE,
  };
}

export function ensureGenesisExecMarkerOnProcess(
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  env[GENESIS_CLI_ENV_VAR] = GENESIS_CLI_ENV_VALUE;
  return env;
}
