import type { Command } from "commander";
import { loadConfig, readConfigFileSnapshot } from "../config/config.js";
import type { GenesisConfig } from "../config/types.genesis.js";
import {
  createPluginCliLogger,
  loadPluginCliDescriptors,
  loadPluginCliRegistrationEntriesWithDefaults,
  type PluginCliLoaderOptions,
} from "./cli-registry-loader.js";
import { registerPluginCliCommandGroups } from "./register-plugin-cli-command-groups.js";
import type { GenesisPluginCliCommandDescriptor } from "./types.js";

type PluginCliRegistrationMode = "eager" | "lazy";

type RegisterPluginCliOptions = {
  mode?: PluginCliRegistrationMode;
  primary?: string | null;
};

const logger = createPluginCliLogger();

export const loadValidatedConfigForPluginRegistration = async (): Promise<GenesisConfig | null> => {
  const snapshot = await readConfigFileSnapshot();
  if (!snapshot.valid) {
    return null;
  }
  return loadConfig();
};

export async function getPluginCliCommandDescriptors(
  cfg?: GenesisConfig,
  env?: NodeJS.ProcessEnv,
  loaderOptions?: PluginCliLoaderOptions,
): Promise<GenesisPluginCliCommandDescriptor[]> {
  return loadPluginCliDescriptors({ cfg, env, loaderOptions });
}

export async function registerPluginCliCommands(
  program: Command,
  cfg?: GenesisConfig,
  env?: NodeJS.ProcessEnv,
  loaderOptions?: PluginCliLoaderOptions,
  options?: RegisterPluginCliOptions,
) {
  const mode = options?.mode ?? "eager";
  const primary = options?.primary ?? undefined;

  await registerPluginCliCommandGroups(
    program,
    await loadPluginCliRegistrationEntriesWithDefaults({
      cfg,
      env,
      loaderOptions,
      primaryCommand: primary,
    }),
    {
      mode,
      primary,
      existingCommands: new Set(program.commands.map((cmd) => cmd.name())),
      logger,
    },
  );
}

export async function registerPluginCliCommandsFromValidatedConfig(
  program: Command,
  env?: NodeJS.ProcessEnv,
  loaderOptions?: PluginCliLoaderOptions,
  options?: RegisterPluginCliOptions,
): Promise<GenesisConfig | null> {
  const config = await loadValidatedConfigForPluginRegistration();
  if (!config) {
    return null;
  }
  await registerPluginCliCommands(program, config, env, loaderOptions, options);
  return config;
}
