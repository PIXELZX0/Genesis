import { Type } from "typebox";
import { optionalStringEnum, stringEnum } from "../runtime-api.js";

export const ORCA_TERMINAL_ACTIONS = [
  "list",
  "show",
  "read",
  "send",
  "wait",
  "create",
  "split",
  "rename",
  "switch",
  "close",
  "stop",
] as const;

export const ORCA_TERMINAL_WAIT_FOR = ["exit", "tui-idle"] as const;

export const OrcaTerminalToolSchema = Type.Object({
  action: stringEnum(ORCA_TERMINAL_ACTIONS),
  terminal: Type.Optional(Type.String()),
  worktree: Type.Optional(Type.String()),
  cursor: Type.Optional(Type.Number()),
  limit: Type.Optional(Type.Number()),
  text: Type.Optional(Type.String()),
  enter: Type.Optional(Type.Boolean()),
  interrupt: Type.Optional(Type.Boolean()),
  for: optionalStringEnum(ORCA_TERMINAL_WAIT_FOR),
  timeoutMs: Type.Optional(Type.Number()),
  name: Type.Optional(Type.String()),
});
