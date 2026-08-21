import fs from "node:fs";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import { resolveUserPath } from "../utils.js";
import { CONTACT_STORE_FILENAME } from "./types.js";

/** Resolve the active state root for the shared contacts store. */
export function resolveContactStateDir(stateDir?: string): string {
  const override = stateDir?.trim();
  return override ? resolveUserPath(override) : resolveStateDir();
}

/** Resolve the shared contacts.json path in the active Genesis state root. */
export function resolveContactStorePath(stateDir?: string): string {
  return path.join(resolveContactStateDir(stateDir), CONTACT_STORE_FILENAME);
}

/**
 * Resolve legacy contacts files for migration fallback.
 * Default-layout files are discovered here; callers that know configured
 * custom agent dirs should pass them explicitly.
 */
export function resolveLegacyContactStorePaths(
  stateDir?: string,
  legacyAgentDirs: readonly string[] = [],
): string[] {
  const agentsRoot = path.join(resolveContactStateDir(stateDir), "agents");
  const paths: string[] = [];
  try {
    paths.push(
      ...fs
        .readdirSync(agentsRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .toSorted((left, right) => left.name.localeCompare(right.name))
        .map((entry) => path.join(agentsRoot, entry.name, "agent", CONTACT_STORE_FILENAME)),
    );
  } catch {
    // The default layout may not exist yet.
  }

  for (const agentDir of legacyAgentDirs) {
    const trimmed = agentDir.trim();
    if (trimmed) {
      paths.push(path.join(resolveUserPath(trimmed), CONTACT_STORE_FILENAME));
    }
  }

  return [...new Set(paths)];
}
