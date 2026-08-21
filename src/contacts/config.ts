import path from "node:path";
import { resolveAgentDir } from "../agents/agent-scope-config.js";
import type { GenesisConfig } from "../config/types.genesis.js";
import { resolveUserPath } from "../utils.js";

function isPathWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
}

/** Contacts are on by default; only an explicit false disables them. */
export function isContactsEnabled(cfg: GenesisConfig | undefined): boolean {
  return cfg?.session?.contacts?.enabled !== false;
}

export type ResolveContactLegacyAgentDirsOptions = {
  /** Explicit state roots are used by tests and must not pull in user env paths. */
  stateDir?: string;
  /** Agent dir used by the current runtime invocation. */
  agentDir?: string;
  env?: NodeJS.ProcessEnv;
};

/** Resolve configured agent dirs whose legacy contacts files may need migration. */
export function resolveContactLegacyAgentDirs(
  cfg: GenesisConfig | undefined,
  options: ResolveContactLegacyAgentDirsOptions = {},
): string[] {
  const env = options.env ?? process.env;
  const dirs = new Set<string>();

  if (cfg) {
    for (const entry of cfg.agents?.list ?? []) {
      if (
        typeof entry?.id === "string" &&
        typeof entry.agentDir === "string" &&
        entry.agentDir.trim().length > 0
      ) {
        dirs.add(resolveAgentDir(cfg, entry.id, env));
      }
    }
  }

  const currentAgentDir = options.agentDir?.trim();
  if (currentAgentDir) {
    dirs.add(resolveUserPath(currentAgentDir, env));
  }

  // An explicit state root isolates callers from runtime env paths outside that
  // root. Explicitly supplied agentDir/configured dirs remain eligible.
  if (!options.stateDir?.trim()) {
    const stateRootOverride = env.GENESIS_STATE_DIR?.trim();
    const resolvedStateRoot = stateRootOverride
      ? path.resolve(resolveUserPath(stateRootOverride, env))
      : undefined;
    for (const runtimeAgentDir of [env.GENESIS_AGENT_DIR, env.PI_CODING_AGENT_DIR]) {
      const trimmed = runtimeAgentDir?.trim();
      if (!trimmed) {
        continue;
      }
      const resolvedAgentDir = path.resolve(resolveUserPath(trimmed, env));
      if (!resolvedStateRoot || isPathWithin(resolvedStateRoot, resolvedAgentDir)) {
        dirs.add(resolvedAgentDir);
      }
    }
  }

  return [...dirs];
}
