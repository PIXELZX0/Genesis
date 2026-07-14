import type { GenesisPluginSecurityAuditContext } from "../runtime-api.js";
import { resolveOrcaIdeConfig } from "./config.js";

type SecurityAuditFinding = {
  checkId: string;
  severity: "warn" | "critical";
  title: string;
  detail: string;
  remediation?: string;
};

const SHELL_METACHARACTER_PATTERN = /[;&|`$<>(){}\n]/;
const EMBEDDED_FLAG_PATTERN = /\s-{1,2}\S/;

function resolveOrcaIdePluginConfig(ctx: GenesisPluginSecurityAuditContext): unknown {
  return (
    ctx.config.plugins?.entries as Record<string, { config?: unknown } | undefined> | undefined
  )?.["orca-ide"]?.config;
}

// The pairingCode secret-plaintext check is handled generically by core via
// this plugin's manifest configContracts.secretInputs declaration — no
// per-plugin code needed for that (see extensions/acpx, same pattern).
export function collectOrcaIdeSecurityAuditFindings(
  ctx: GenesisPluginSecurityAuditContext,
): SecurityAuditFinding[] {
  const findings: SecurityAuditFinding[] = [];

  const resolved = resolveOrcaIdeConfig(resolveOrcaIdePluginConfig(ctx));

  if (
    SHELL_METACHARACTER_PATTERN.test(resolved.command) ||
    EMBEDDED_FLAG_PATTERN.test(resolved.command)
  ) {
    findings.push({
      checkId: "orca-ide.command_looks_suspicious",
      severity: "warn",
      title: "orca-ide.command looks like more than a bare executable",
      detail:
        `Configured orca-ide.command ("${resolved.command}") contains shell metacharacters or embedded ` +
        "flags. It is passed as a single argv entry, never through a shell, so this is defense-in-depth " +
        "rather than a real injection vector — but a misconfigured value shouldn't itself carry extra arguments.",
      remediation:
        'Set orca-ide.command to a plain executable name or path (e.g. "orca" or "orca-ide"); use ' +
        "orca-ide.environment / orca-ide.pairingCode for the remote-targeting flags instead.",
    });
  }

  return findings;
}
