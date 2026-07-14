import type { AnyAgentTool } from "../runtime-api.js";
import { jsonResult } from "../runtime-api.js";
import type { ResolvedOrcaIdeConfig } from "./config.js";
import { runOrca, type OrcaCliDeps } from "./orca-cli.js";
import { ORCA_WORKTREE_ACTIONS, OrcaWorktreeToolSchema } from "./orca-worktree-tool.schema.js";

type OrcaWorktreeAction = (typeof ORCA_WORKTREE_ACTIONS)[number];

function str(raw: Record<string, unknown>, key: string): string | undefined {
  const value = raw[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function bool(raw: Record<string, unknown>, key: string): boolean | undefined {
  const value = raw[key];
  return typeof value === "boolean" ? value : undefined;
}

function requireWorktree(raw: Record<string, unknown>, action: OrcaWorktreeAction): string {
  const worktree = str(raw, "worktree");
  if (!worktree) {
    throw new Error(`worktree required for ${action}`);
  }
  return worktree;
}

export function buildOrcaWorktreeArgv(
  action: OrcaWorktreeAction,
  raw: Record<string, unknown>,
): string[] {
  switch (action) {
    case "list":
      return ["worktree", "list"];
    case "current":
      return ["worktree", "current"];
    case "ps":
      return ["worktree", "ps"];
    case "show":
      return ["worktree", "show", "--worktree", requireWorktree(raw, action)];
    case "set":
      return ["worktree", "set", "--worktree", requireWorktree(raw, action)];
    case "rm": {
      const argv = ["worktree", "rm", "--worktree", requireWorktree(raw, action)];
      if (bool(raw, "force")) {
        argv.push("--force");
      }
      return argv;
    }
    case "create": {
      const name = str(raw, "name");
      if (!name) {
        throw new Error("name required for create");
      }
      const argv = ["worktree", "create", "--name", name];
      const repo = str(raw, "repo");
      if (repo) {
        argv.push("--repo", repo);
      }
      const agent = str(raw, "agent");
      if (agent) {
        argv.push("--agent", agent);
      }
      const prompt = str(raw, "prompt");
      if (prompt) {
        argv.push("--prompt", prompt);
      }
      const baseBranch = str(raw, "baseBranch");
      if (baseBranch) {
        argv.push("--base-branch", baseBranch);
      }
      if (bool(raw, "noParent")) {
        argv.push("--no-parent");
      } else {
        const parentWorktree = str(raw, "parentWorktree");
        if (parentWorktree) {
          argv.push("--parent-worktree", parentWorktree);
        }
      }
      const setup = str(raw, "setup");
      if (setup) {
        argv.push("--setup", setup);
      }
      return argv;
    }
    default: {
      const exhaustive: never = action;
      throw new Error(`unknown action: ${exhaustive as string}`);
    }
  }
}

export function createOrcaWorktreeTool(params: {
  config: ResolvedOrcaIdeConfig;
  deps?: OrcaCliDeps;
}): AnyAgentTool {
  return {
    name: "orca_worktree",
    label: "Orca Worktree",
    description:
      "Create and manage Orca IDE worktrees via the `orca` CLI. Actions: list, show, current, create, set, rm, ps. " +
      "`create`/`show` return a worktreePath — use Genesis's own Read/Write/Edit/Glob tools on that path for file " +
      "I/O; this tool does not read or write file contents itself.",
    parameters: OrcaWorktreeToolSchema,
    async execute(_toolCallId, rawParams) {
      const raw = (rawParams && typeof rawParams === "object" ? rawParams : {}) as Record<
        string,
        unknown
      >;
      const action = str(raw, "action") as OrcaWorktreeAction | undefined;
      if (!action || !(ORCA_WORKTREE_ACTIONS as readonly string[]).includes(action)) {
        throw new Error(`unknown action: ${action ?? "(none)"}`);
      }
      const args = buildOrcaWorktreeArgv(action, raw);
      const result = await runOrca({ config: params.config, args }, params.deps);
      return jsonResult(result);
    },
  } satisfies AnyAgentTool;
}
