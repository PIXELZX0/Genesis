import { describe, expect, it, vi } from "vitest";
import type { PluginCommandRunOptions, PluginCommandRunResult } from "../runtime-api.js";
import { resolveOrcaIdeConfig, type ResolvedOrcaIdeConfig } from "./config.js";
import { buildOrcaArgv, OrcaCliError, resolveOrcaCommand, runOrca } from "./orca-cli.js";

function baseConfig(overrides: Partial<ResolvedOrcaIdeConfig> = {}): ResolvedOrcaIdeConfig {
  return { ...resolveOrcaIdeConfig(undefined), ...overrides };
}

function commandResult(overrides: Partial<PluginCommandRunResult> = {}): PluginCommandRunResult {
  return { code: 0, stdout: "{}", stderr: "", ...overrides };
}

describe("resolveOrcaCommand", () => {
  it("defaults to orca", () => {
    expect(resolveOrcaCommand(baseConfig(), {})).toBe("orca");
  });

  it("prefers config.command over the default", () => {
    expect(resolveOrcaCommand(baseConfig({ command: "orca-ide" }), {})).toBe("orca-ide");
  });

  it("prefers ORCA_CLI_COMMAND over config.command", () => {
    expect(
      resolveOrcaCommand(baseConfig({ command: "orca-ide" }), { ORCA_CLI_COMMAND: "orca-dev" }),
    ).toBe("orca-dev");
  });
});

describe("buildOrcaArgv", () => {
  it("appends --json and no remote flags by default", () => {
    expect(buildOrcaArgv({ config: baseConfig(), args: ["worktree", "list"] })).toEqual([
      "orca",
      "worktree",
      "list",
      "--json",
    ]);
  });

  it("appends --environment and --pairing-code when configured", () => {
    expect(
      buildOrcaArgv({
        config: baseConfig({ environment: "prod", pairingCode: "abc123" }),
        args: ["worktree", "list"],
      }),
    ).toEqual([
      "orca",
      "worktree",
      "list",
      "--json",
      "--environment",
      "prod",
      "--pairing-code",
      "abc123",
    ]);
  });
});

describe("runOrca", () => {
  it("parses JSON stdout on success", async () => {
    const runCommand = vi.fn<(options: PluginCommandRunOptions) => Promise<PluginCommandRunResult>>(
      async () => commandResult({ stdout: '{"ok":true}' }),
    );
    await expect(
      runOrca({ config: baseConfig(), args: ["worktree", "list"] }, { runCommand }),
    ).resolves.toEqual({ ok: true });
    expect(runCommand).toHaveBeenCalledWith(
      expect.objectContaining({ argv: ["orca", "worktree", "list", "--json"], timeoutMs: 30_000 }),
    );
  });

  it("uses the timeoutMs override when provided", async () => {
    const runCommand = vi.fn<(options: PluginCommandRunOptions) => Promise<PluginCommandRunResult>>(
      async () => commandResult(),
    );
    await runOrca(
      { config: baseConfig(), args: ["terminal", "wait"], timeoutMs: 12_345 },
      { runCommand },
    );
    expect(runCommand).toHaveBeenCalledWith(expect.objectContaining({ timeoutMs: 12_345 }));
  });

  it("throws a distinct error for a missing CLI binary", async () => {
    const runCommand = vi.fn<(options: PluginCommandRunOptions) => Promise<PluginCommandRunResult>>(
      async () => commandResult({ code: 127, stdout: "", stderr: "spawn orca ENOENT" }),
    );
    await expect(
      runOrca({ config: baseConfig(), args: ["worktree", "list"] }, { runCommand }),
    ).rejects.toThrow(/was not found/);
  });

  it("throws OrcaCliError with stderr for a generic non-zero exit", async () => {
    const runCommand = vi.fn<(options: PluginCommandRunOptions) => Promise<PluginCommandRunResult>>(
      async () => commandResult({ code: 1, stdout: "", stderr: "worktree not found" }),
    );
    const promise = runOrca({ config: baseConfig(), args: ["worktree", "show"] }, { runCommand });
    await expect(promise).rejects.toBeInstanceOf(OrcaCliError);
    await expect(promise).rejects.toThrow(/worktree not found/);
  });

  it("throws OrcaCliError when stdout is not valid JSON", async () => {
    const runCommand = vi.fn<(options: PluginCommandRunOptions) => Promise<PluginCommandRunResult>>(
      async () => commandResult({ stdout: "not json" }),
    );
    await expect(
      runOrca({ config: baseConfig(), args: ["worktree", "list"] }, { runCommand }),
    ).rejects.toThrow(/did not return valid JSON/);
  });
});
