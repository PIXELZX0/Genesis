import { describe, expect, it, vi } from "vitest";
import type { PluginCommandRunOptions, PluginCommandRunResult } from "../runtime-api.js";
import { resolveOrcaIdeConfig } from "./config.js";
import { buildOrcaTerminalArgv, createOrcaTerminalTool } from "./orca-terminal-tool.js";
import { ORCA_TERMINAL_ACTIONS } from "./orca-terminal-tool.schema.js";

describe("buildOrcaTerminalArgv", () => {
  it("builds list with no flags", () => {
    expect(buildOrcaTerminalArgv("list", {})).toEqual(["terminal", "list"]);
  });

  it("builds read with optional cursor/limit and terminal handle", () => {
    expect(buildOrcaTerminalArgv("read", {})).toEqual(["terminal", "read"]);
    expect(buildOrcaTerminalArgv("read", { terminal: "t1", cursor: 5, limit: 100 })).toEqual([
      "terminal",
      "read",
      "--terminal",
      "t1",
      "--cursor",
      "5",
      "--limit",
      "100",
    ]);
  });

  it("requires text for send and appends enter/interrupt flags", () => {
    expect(() => buildOrcaTerminalArgv("send", {})).toThrow(/text required/);
    expect(buildOrcaTerminalArgv("send", { text: "ls\n", enter: true })).toEqual([
      "terminal",
      "send",
      "--text",
      "ls\n",
      "--enter",
    ]);
    expect(buildOrcaTerminalArgv("send", { text: "C-c", interrupt: true })).toEqual([
      "terminal",
      "send",
      "--text",
      "C-c",
      "--interrupt",
    ]);
  });

  it("requires for to be exit or tui-idle for wait", () => {
    expect(() => buildOrcaTerminalArgv("wait", {})).toThrow(/for required/);
    expect(buildOrcaTerminalArgv("wait", { for: "tui-idle", timeoutMs: 5000 })).toEqual([
      "terminal",
      "wait",
      "--for",
      "tui-idle",
      "--timeout-ms",
      "5000",
    ]);
  });

  it("builds create with optional worktree/name", () => {
    expect(buildOrcaTerminalArgv("create", { worktree: "id:x", name: "shell" })).toEqual([
      "terminal",
      "create",
      "--worktree",
      "id:x",
      "--name",
      "shell",
    ]);
  });

  it("requires name for rename", () => {
    expect(() => buildOrcaTerminalArgv("rename", { terminal: "t1" })).toThrow(/name required/);
    expect(buildOrcaTerminalArgv("rename", { terminal: "t1", name: "build" })).toEqual([
      "terminal",
      "rename",
      "--terminal",
      "t1",
      "--name",
      "build",
    ]);
  });

  it("builds split/switch/close/stop with just the terminal handle", () => {
    for (const action of ["split", "switch", "close", "stop"] as const) {
      expect(buildOrcaTerminalArgv(action, { terminal: "t1" })).toEqual([
        "terminal",
        action,
        "--terminal",
        "t1",
      ]);
    }
  });

  it("covers every declared action", () => {
    for (const action of ORCA_TERMINAL_ACTIONS) {
      expect(() =>
        buildOrcaTerminalArgv(action, { terminal: "t1", text: "x", for: "exit", name: "n" }),
      ).not.toThrow();
    }
  });
});

describe("createOrcaTerminalTool", () => {
  it("is registered as orca_terminal", () => {
    const tool = createOrcaTerminalTool({ config: resolveOrcaIdeConfig(undefined) });
    expect(tool.name).toBe("orca_terminal");
  });

  it("rejects an unknown action", async () => {
    const tool = createOrcaTerminalTool({ config: resolveOrcaIdeConfig(undefined) });
    await expect(tool.execute("call-1", { action: "nope" })).rejects.toThrow(/unknown action/);
  });

  it("clamps the wait timeout to the configured ceiling plus buffer", async () => {
    const runCommand = vi.fn<(options: PluginCommandRunOptions) => Promise<PluginCommandRunResult>>(
      async () => ({ code: 0, stdout: "{}", stderr: "" }),
    );
    const tool = createOrcaTerminalTool({
      config: resolveOrcaIdeConfig({ waitTimeoutSeconds: 60 }),
      deps: { runCommand },
    });
    await tool.execute("call-1", { action: "wait", for: "tui-idle", timeoutMs: 999_999 });
    expect(runCommand).toHaveBeenCalledWith(
      expect.objectContaining({ timeoutMs: 60_000 + 10_000 }),
    );
  });

  it("uses request-only timeout for non-wait actions", async () => {
    const runCommand = vi.fn<(options: PluginCommandRunOptions) => Promise<PluginCommandRunResult>>(
      async () => ({ code: 0, stdout: "{}", stderr: "" }),
    );
    const tool = createOrcaTerminalTool({
      config: resolveOrcaIdeConfig(undefined),
      deps: { runCommand },
    });
    await tool.execute("call-1", { action: "list" });
    expect(runCommand).toHaveBeenCalledWith(expect.objectContaining({ timeoutMs: 30_000 }));
  });
});
