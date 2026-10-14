import type { GenesisConfig } from "../config/types.genesis.js";
import { resolveManifestActivationPluginIds } from "../plugins/activation-planner.js";
import { loadPluginManifestRegistry } from "../plugins/manifest-registry.js";
import { getActivePluginRegistry } from "../plugins/runtime.js";

let pluginRegistryLoaderModulePromise:
  | Promise<typeof import("../plugins/runtime/runtime-registry-loader.js")>
  | undefined;

async function loadPluginRegistryLoaderModule() {
  pluginRegistryLoaderModulePromise ??= import("../plugins/runtime/runtime-registry-loader.js");
  return await pluginRegistryLoaderModulePromise;
}

/**
 * Plugins the node host must load: bundled plugins that declare
 * `activation.onCapabilities: ["node-host"]`, plus every non-bundled plugin
 * (third-party plugins predate the hint and may register node-host commands).
 * Skipping the rest keeps provider/channel runtimes out of the node process.
 */
export function resolveNodeHostPluginIds(params: {
  config: GenesisConfig;
  env?: NodeJS.ProcessEnv;
}): string[] {
  const declared = resolveManifestActivationPluginIds({
    trigger: { kind: "capability", capability: "node-host" },
    config: params.config,
    env: params.env,
    origin: "bundled",
  });
  const external = loadPluginManifestRegistry({ config: params.config, env: params.env })
    .plugins.filter((plugin) => plugin.origin !== "bundled")
    .map((plugin) => plugin.id);
  return [...new Set([...declared, ...external])].toSorted((left, right) =>
    left.localeCompare(right),
  );
}

export async function ensureNodeHostPluginRegistry(params: {
  config: GenesisConfig;
  env?: NodeJS.ProcessEnv;
}): Promise<void> {
  const onlyPluginIds = resolveNodeHostPluginIds(params);
  if (onlyPluginIds.length === 0) {
    return;
  }
  (await loadPluginRegistryLoaderModule()).ensurePluginRegistryLoaded({
    scope: "all",
    config: params.config,
    activationSourceConfig: params.config,
    env: params.env,
    onlyPluginIds,
  });
}

export function listRegisteredNodeHostCapsAndCommands(): {
  caps: string[];
  commands: string[];
} {
  const registry = getActivePluginRegistry();
  const caps = new Set<string>();
  const commands = new Set<string>();
  for (const entry of registry?.nodeHostCommands ?? []) {
    if (entry.command.cap) {
      caps.add(entry.command.cap);
    }
    commands.add(entry.command.command);
  }
  return {
    caps: [...caps].toSorted((left, right) => left.localeCompare(right)),
    commands: [...commands].toSorted((left, right) => left.localeCompare(right)),
  };
}

export async function invokeRegisteredNodeHostCommand(
  command: string,
  paramsJSON?: string | null,
): Promise<string | null> {
  const registry = getActivePluginRegistry();
  const match = (registry?.nodeHostCommands ?? []).find(
    (entry) => entry.command.command === command,
  );
  if (!match) {
    return null;
  }
  return await match.command.handle(paramsJSON);
}
