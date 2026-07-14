import { describe, expect, it, vi } from "vitest";
import type { PluginCommandRunOptions, PluginCommandRunResult } from "../runtime-api.js";
import { resolveOrcaIdeConfig } from "./config.js";
import { buildOrcaWorktreeArgv, createOrcaWorktreeTool } from "./orca-worktree-tool.js";
import { ORCA_WORKTREE_ACTIONS } from "./orca-worktree-tool.schema.js";

describe("buildOrcaWorktreeArgv", () => {
  it("builds list/current/ps with no flags", () => {
    expect(buildOrcaWorktreeArgv("list", {})).toEqual(["worktree", "list"]);
    expect(buildOrcaWorktreeArgv("current", {})).toEqual(["worktree", "current"]);
    expect(buildOrcaWorktreeArgv("ps", {})).toEqual(["worktree", "ps"]);
  });

  it("requires worktree for show/set/rm", () => {
    expect(() => buildOrcaWorktreeArgv("show", {})).toThrow(/worktree required/);
    expect(buildOrcaWorktreeArgv("show", { worktree: "id:abc" })).toEqual([
      "worktree",
      "show",
      "--worktree",
      "id:abc",
    ]);
    expect(buildOrcaWorktreeArgv("set", { worktree: "id:abc" })).toEqual([
      "worktree",
      "set",
      "--worktree",
      "id:abc",
    ]);
  });

  it("adds --force to rm only when requested", () => {
    expect(buildOrcaWorktreeArgv("rm", { worktree: "id:abc" })).toEqual([
      "worktree",
      "rm",
      "--worktree",
      "id:abc",
    ]);
    expect(buildOrcaWorktreeArgv("rm", { worktree: "id:abc", force: true })).toEqual([
      "worktree",
      "rm",
      "--worktree",
      "id:abc",
      "--force",
    ]);
  });

  it("requires name for create and builds full flag set", () => {
    expect(() => buildOrcaWorktreeArgv("create", {})).toThrow(/name required/);
    expect(
      buildOrcaWorktreeArgv("create", {
        name: "feature-x",
        agent: "codex",
        prompt: "hi",
        noParent: true,
        setup: "run",
      }),
    ).toEqual([
      "worktree",
      "create",
      "--name",
      "feature-x",
      "--agent",
      "codex",
      "--prompt",
      "hi",
      "--no-parent",
      "--setup",
      "run",
    ]);
  });

  it("prefers noParent over parentWorktree when both are set", () => {
    expect(
      buildOrcaWorktreeArgv("create", { name: "x", noParent: true, parentWorktree: "id:y" }),
    ).toEqual(["worktree", "create", "--name", "x", "--no-parent"]);
  });

  it("uses parentWorktree when noParent is not set", () => {
    expect(buildOrcaWorktreeArgv("create", { name: "x", parentWorktree: "id:y" })).toEqual([
      "worktree",
      "create",
      "--name",
      "x",
      "--parent-worktree",
      "id:y",
    ]);
  });
});

describe("createOrcaWorktreeTool", () => {
  it("is registered as orca_worktree", () => {
    const tool = createOrcaWorktreeTool({ config: resolveOrcaIdeConfig(undefined) });
    expect(tool.name).toBe("orca_worktree");
  });

  it("dispatches every action to a distinct argv builder without throwing on required-field errors alone", () => {
    for (const action of ORCA_WORKTREE_ACTIONS) {
      expect(() => buildOrcaWorktreeArgv(action, { worktree: "id:x", name: "x" })).not.toThrow();
    }
  });

  it("runs the built argv through runOrca and returns a JSON tool result", async () => {
    const runCommand = vi.fn<(options: PluginCommandRunOptions) => Promise<PluginCommandRunResult>>(
      async () => ({ code: 0, stdout: '{"worktrees":[]}', stderr: "" }),
    );
    const tool = createOrcaWorktreeTool({
      config: resolveOrcaIdeConfig(undefined),
      deps: { runCommand },
    });
    await tool.execute("call-1", { action: "list" });
    expect(runCommand).toHaveBeenCalledWith(
      expect.objectContaining({ argv: ["orca", "worktree", "list", "--json"] }),
    );
  });

  it("rejects an unknown action", async () => {
    const tool = createOrcaWorktreeTool({ config: resolveOrcaIdeConfig(undefined) });
    await expect(tool.execute("call-1", { action: "nope" })).rejects.toThrow(/unknown action/);
  });
});
