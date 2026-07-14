import { describe, expect, it } from "vitest";
import type { GenesisPluginSecurityAuditContext } from "../runtime-api.js";
import { collectOrcaIdeSecurityAuditFindings } from "./security-audit.js";

function ctxWithConfig(pluginConfig: unknown): GenesisPluginSecurityAuditContext {
  return {
    config: { plugins: { entries: { "orca-ide": { config: pluginConfig } } } },
    sourceConfig: { plugins: { entries: { "orca-ide": { config: pluginConfig } } } },
    env: {},
    stateDir: "/tmp",
    configPath: "/tmp/genesis.json",
  } as unknown as GenesisPluginSecurityAuditContext;
}

describe("collectOrcaIdeSecurityAuditFindings", () => {
  it("reports nothing for the default command", () => {
    expect(collectOrcaIdeSecurityAuditFindings(ctxWithConfig(undefined))).toEqual([]);
  });

  it("reports nothing for a plain command override", () => {
    expect(collectOrcaIdeSecurityAuditFindings(ctxWithConfig({ command: "orca-ide" }))).toEqual([]);
  });

  it("flags a command containing shell metacharacters", () => {
    const findings = collectOrcaIdeSecurityAuditFindings(
      ctxWithConfig({ command: "orca; rm -rf /" }),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.checkId).toBe("orca-ide.command_looks_suspicious");
  });

  it("flags a command with embedded flags", () => {
    const findings = collectOrcaIdeSecurityAuditFindings(
      ctxWithConfig({ command: "orca --danger" }),
    );
    expect(findings).toHaveLength(1);
  });
});
