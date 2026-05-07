import type { GenesisConfig } from "../config/types.genesis.js";
import { resolveRuntimePluginRegistry } from "./loader.js";
import { getMemoryRuntime } from "./memory-state.js";
import {
  buildPluginRuntimeLoadOptions,
  resolvePluginRuntimeLoadContext,
} from "./runtime/load-context.js";

type MemoryRuntimeOptions = {
  installBundledRuntimeDeps?: boolean;
};

function ensureMemoryRuntime(cfg?: GenesisConfig, options?: MemoryRuntimeOptions) {
  const current = getMemoryRuntime();
  if (current || !cfg) {
    return current;
  }
  resolveRuntimePluginRegistry(
    buildPluginRuntimeLoadOptions(resolvePluginRuntimeLoadContext({ config: cfg }), {
      installBundledRuntimeDeps: options?.installBundledRuntimeDeps,
    }),
  );
  return getMemoryRuntime();
}

export async function getActiveMemorySearchManager(params: {
  cfg: GenesisConfig;
  agentId: string;
  purpose?: "default" | "status";
}) {
  const runtime = ensureMemoryRuntime(params.cfg, {
    installBundledRuntimeDeps: params.purpose === "status" ? false : undefined,
  });
  if (!runtime) {
    return { manager: null, error: "memory plugin unavailable" };
  }
  return await runtime.getMemorySearchManager(params);
}

export function resolveActiveMemoryBackendConfig(params: {
  cfg: GenesisConfig;
  agentId: string;
  installBundledRuntimeDeps?: boolean;
}) {
  return (
    ensureMemoryRuntime(params.cfg, {
      installBundledRuntimeDeps: params.installBundledRuntimeDeps,
    })?.resolveMemoryBackendConfig(params) ?? null
  );
}

export async function closeActiveMemorySearchManagers(cfg?: GenesisConfig): Promise<void> {
  void cfg;
  const runtime = getMemoryRuntime();
  await runtime?.closeAllMemorySearchManagers?.();
}
