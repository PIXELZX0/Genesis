import { Type } from "typebox";
import { optionalStringEnum, stringEnum } from "../runtime-api.js";

export const ORCA_WORKTREE_ACTIONS = [
  "list",
  "show",
  "current",
  "create",
  "set",
  "rm",
  "ps",
] as const;

export const ORCA_WORKTREE_SETUP_MODES = ["run", "skip", "inherit"] as const;

export const OrcaWorktreeToolSchema = Type.Object({
  action: stringEnum(ORCA_WORKTREE_ACTIONS),
  worktree: Type.Optional(Type.String()),
  name: Type.Optional(Type.String()),
  repo: Type.Optional(Type.String()),
  agent: Type.Optional(Type.String()),
  prompt: Type.Optional(Type.String()),
  baseBranch: Type.Optional(Type.String()),
  parentWorktree: Type.Optional(Type.String()),
  noParent: Type.Optional(Type.Boolean()),
  setup: optionalStringEnum(ORCA_WORKTREE_SETUP_MODES),
  force: Type.Optional(Type.Boolean()),
});
