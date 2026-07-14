import type { AnyAgentTool } from "../runtime-api.js";
import { jsonResult } from "../runtime-api.js";
import type { ResolvedOrcaIdeConfig } from "./config.js";
import { runOrca, type OrcaCliDeps } from "./orca-cli.js";
import { ORCA_TERMINAL_ACTIONS, OrcaTerminalToolSchema } from "./orca-terminal-tool.schema.js";

type OrcaTerminalAction = (typeof ORCA_TERMINAL_ACTIONS)[number];

/** Extra headroom above the requested wait so the process runner does not kill `orca terminal wait` before it returns. */
const WAIT_TIMEOUT_BUFFER_MS = 10_000;

function str(raw: Record<string, unknown>, key: string): string | undefined {
  const value = raw[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** Unlike `str`, does not trim — terminal input can be meaningful whitespace (e.g. a trailing newline to submit). */
function rawText(raw: Record<string, unknown>, key: string): string | undefined {
  const value = raw[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function bool(raw: Record<string, unknown>, key: string): boolean | undefined {
  const value = raw[key];
  return typeof value === "boolean" ? value : undefined;
}

function num(raw: Record<string, unknown>, key: string): number | undefined {
  const value = raw[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function withTerminal(argv: string[], raw: Record<string, unknown>): string[] {
  const terminal = str(raw, "terminal");
  return terminal ? [...argv, "--terminal", terminal] : argv;
}

export function buildOrcaTerminalArgv(
  action: OrcaTerminalAction,
  raw: Record<string, unknown>,
): string[] {
  switch (action) {
    case "list":
      return ["terminal", "list"];
    case "show":
      return withTerminal(["terminal", "show"], raw);
    case "read": {
      let argv = withTerminal(["terminal", "read"], raw);
      const cursor = num(raw, "cursor");
      if (cursor !== undefined) {
        argv = [...argv, "--cursor", String(cursor)];
      }
      const limit = num(raw, "limit");
      if (limit !== undefined) {
        argv = [...argv, "--limit", String(limit)];
      }
      return argv;
    }
    case "send": {
      const text = rawText(raw, "text");
      if (text === undefined) {
        throw new Error("text required for send");
      }
      let argv = withTerminal(["terminal", "send"], raw);
      argv = [...argv, "--text", text];
      if (bool(raw, "enter")) {
        argv = [...argv, "--enter"];
      }
      if (bool(raw, "interrupt")) {
        argv = [...argv, "--interrupt"];
      }
      return argv;
    }
    case "wait": {
      const waitFor = str(raw, "for");
      if (waitFor !== "exit" && waitFor !== "tui-idle") {
        throw new Error('for required for wait ("exit" or "tui-idle")');
      }
      let argv = withTerminal(["terminal", "wait"], raw);
      argv = [...argv, "--for", waitFor];
      const timeoutMs = num(raw, "timeoutMs");
      if (timeoutMs !== undefined) {
        argv = [...argv, "--timeout-ms", String(timeoutMs)];
      }
      return argv;
    }
    case "create": {
      const argv = ["terminal", "create"];
      const worktree = str(raw, "worktree");
      if (worktree) {
        argv.push("--worktree", worktree);
      }
      const name = str(raw, "name");
      if (name) {
        argv.push("--name", name);
      }
      return argv;
    }
    case "split":
      return withTerminal(["terminal", "split"], raw);
    case "rename": {
      const name = str(raw, "name");
      if (!name) {
        throw new Error("name required for rename");
      }
      return [...withTerminal(["terminal", "rename"], raw), "--name", name];
    }
    case "switch":
      return withTerminal(["terminal", "switch"], raw);
    case "close":
      return withTerminal(["terminal", "close"], raw);
    case "stop":
      return withTerminal(["terminal", "stop"], raw);
    default: {
      const exhaustive: never = action;
      throw new Error(`unknown action: ${exhaustive as string}`);
    }
  }
}

/** Clamp a requested wait to the configured ceiling, and pad the process-level timeout so it outlives the CLI's own wait. */
function resolveWaitCommandTimeoutMs(
  raw: Record<string, unknown>,
  config: ResolvedOrcaIdeConfig,
): number {
  const requested = num(raw, "timeoutMs") ?? config.waitTimeoutMs;
  const effective = Math.min(requested, config.waitTimeoutMs);
  return effective + WAIT_TIMEOUT_BUFFER_MS;
}

export function createOrcaTerminalTool(params: {
  config: ResolvedOrcaIdeConfig;
  deps?: OrcaCliDeps;
}): AnyAgentTool {
  return {
    name: "orca_terminal",
    label: "Orca Terminal",
    description:
      "Read and drive terminals inside Orca IDE worktrees via the `orca` CLI. Actions: list, show, read, send, " +
      "wait, create, split, rename, switch, close, stop. `read` is cursor-paginated (response has oldestCursor/" +
      "nextCursor/limited) — pass the previous nextCursor back in to read new output. `wait` blocks for `for: " +
      '"exit"|"tui-idle"`.',
    parameters: OrcaTerminalToolSchema,
    async execute(_toolCallId, rawParams) {
      const raw = (rawParams && typeof rawParams === "object" ? rawParams : {}) as Record<
        string,
        unknown
      >;
      const action = str(raw, "action") as OrcaTerminalAction | undefined;
      if (!action || !(ORCA_TERMINAL_ACTIONS as readonly string[]).includes(action)) {
        throw new Error(`unknown action: ${action ?? "(none)"}`);
      }
      const args = buildOrcaTerminalArgv(action, raw);
      const timeoutMs =
        action === "wait" ? resolveWaitCommandTimeoutMs(raw, params.config) : undefined;
      const result = await runOrca({ config: params.config, args, timeoutMs }, params.deps);
      return jsonResult(result);
    },
  } satisfies AnyAgentTool;
}
