import { resolveCliArgvInvocation } from "./argv-invocation.js";

export function shouldSkipRespawnForArgv(argv: string[]): boolean {
  return resolveCliArgvInvocation(argv).hasHelpOrVersion;
}

/**
 * Long-running lightweight hosts (`genesis node run`) skip the respawn that only
 * adds `--disable-warning=ExperimentalWarning`: the extra supervisor process costs
 * tens of MB on small devices, and the in-process warning filter already covers
 * the warnings we care about.
 */
export function shouldSkipWarningOnlyRespawnForArgv(argv: string[]): boolean {
  const [primary, sub] = resolveCliArgvInvocation(argv).commandPath;
  return primary === "node" && sub === "run";
}
