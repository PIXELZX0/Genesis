import path from "node:path";
import { resolveGenesisAgentDir } from "../agents/agent-paths.js";
import { resolveUserPath } from "../utils.js";
import { CONTACT_STORE_FILENAME } from "./types.js";

/** Resolve the contacts.json path for an agent dir (defaults to the main agent). */
export function resolveContactStorePath(agentDir?: string): string {
  const resolved = resolveUserPath(agentDir ?? resolveGenesisAgentDir());
  return path.join(resolved, CONTACT_STORE_FILENAME);
}
