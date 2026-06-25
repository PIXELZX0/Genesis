import path from "node:path";
import { normalizeLowercaseStringOrEmpty } from "../shared/string-coerce.js";
import type { ExecCommandAnalysis, ExecCommandSegment } from "./exec-approvals-analysis.js";

/**
 * Safeguard: deterministic, heuristic risk classification for shell commands.
 *
 * Operates on an already-parsed {@link ExecCommandAnalysis} (segments/argv) so
 * it never re-parses raw command strings. The verdict only ever *tightens* the
 * existing exec-approval decision — callers map:
 *   high   -> block outright
 *   medium -> force a user approval prompt
 *   low    -> existing behavior (allowlist/ask)
 *
 * This is intentionally conservative: when a command cannot be analyzed we
 * return "low" and let the existing approval machinery handle it, rather than
 * guessing.
 */
export type SafeguardRisk = "high" | "medium" | "low";

export type SafeguardVerdict = {
  risk: SafeguardRisk;
  reasons: string[];
};

const RISK_ORDER: Record<SafeguardRisk, number> = { low: 0, medium: 1, high: 2 };

/** Filesystem roots whose recursive deletion / modification is catastrophic. */
const CATASTROPHIC_TARGETS = new Set<string>([
  "/",
  "/*",
  "~",
  "~/",
  "$home",
  "$home/",
  "*",
  "/bin",
  "/boot",
  "/dev",
  "/etc",
  "/home",
  "/lib",
  "/lib64",
  "/opt",
  "/proc",
  "/root",
  "/sbin",
  "/sys",
  "/usr",
  "/var",
]);

const SHELL_BINS = new Set(["sh", "bash", "zsh", "dash", "ksh", "fish"]);
const FETCH_BINS = new Set(["curl", "wget", "fetch"]);
const POWER_BINS = new Set(["shutdown", "reboot", "halt", "poweroff"]);

function basenameLower(token: string): string {
  return normalizeLowercaseStringOrEmpty(path.basename(token.trim()));
}

function segmentBin(segment: ExecCommandSegment): string {
  const execName = segment.resolution?.execution?.executableName;
  if (execName && execName.trim()) {
    return normalizeLowercaseStringOrEmpty(execName);
  }
  return basenameLower(segment.argv[0] ?? "");
}

function isLongFlag(arg: string, name: string): boolean {
  return arg === `--${name}`;
}

/**
 * True if a short-flag cluster (e.g. "-rf" or "-R") contains the given letter.
 * Matching is case-insensitive so both `rm -r` and `chmod -R` are detected.
 */
function shortClusterHas(arg: string, letter: string): boolean {
  return (
    /^-[a-z]+$/i.test(arg) &&
    !arg.startsWith("--") &&
    arg.slice(1).toLowerCase().includes(letter.toLowerCase())
  );
}

function hasFlag(args: string[], letter: string, longName: string): boolean {
  return args.some((a) => shortClusterHas(a, letter) || isLongFlag(a, longName));
}

function nonFlagArgs(args: string[]): string[] {
  return args.filter((a) => !a.startsWith("-"));
}

function normalizeTarget(token: string): string {
  const trimmed = normalizeLowercaseStringOrEmpty(token);
  if (trimmed.length > 1 && trimmed.endsWith("/")) {
    return trimmed.slice(0, -1);
  }
  return trimmed;
}

function isCatastrophicTarget(token: string): boolean {
  const t = normalizeTarget(token);
  if (CATASTROPHIC_TARGETS.has(t)) {
    return true;
  }
  // "/foo" forms: a top-level absolute path with a trailing glob (e.g. "/usr/*").
  if (t === "/*" || /^\/[a-z0-9_.-]+\/\*$/i.test(t)) {
    return true;
  }
  return false;
}

function isAbsoluteTarget(token: string): boolean {
  const t = normalizeTarget(token);
  return t.startsWith("/") || t.startsWith("~") || t.startsWith("$home");
}

/** Detect a classic bash fork bomb in raw command text. */
function isForkBomb(text: string): boolean {
  const compact = text.replace(/\s+/g, "");
  return compact.includes(":(){:|:&}");
}

/** Detect a redirection that overwrites a raw block device (e.g. `> /dev/sda`). */
function redirectsToBlockDevice(text: string): boolean {
  return /(^|\s|>)>\s*\/dev\/(sd[a-z]|nvme\d|disk\d|hd[a-z])/i.test(text);
}

type SegmentFinding = { risk: SafeguardRisk; reason: string };

function evaluateRm(args: string[]): SegmentFinding | null {
  const recursive = hasFlag(args, "r", "recursive") || args.some((a) => isLongFlag(a, "recursive"));
  const force = hasFlag(args, "f", "force");
  if (!recursive) {
    return null;
  }
  const targets = nonFlagArgs(args);
  if (targets.some(isCatastrophicTarget)) {
    return {
      risk: "high",
      reason: `recursive delete of a system root path (rm ${args.join(" ")})`,
    };
  }
  if (force && targets.some(isAbsoluteTarget)) {
    return {
      risk: "medium",
      reason: `recursive force delete of an absolute path (rm ${args.join(" ")})`,
    };
  }
  if (force) {
    return { risk: "medium", reason: `recursive force delete (rm ${args.join(" ")})` };
  }
  return null;
}

function evaluateChmodChown(bin: string, args: string[]): SegmentFinding | null {
  const recursive = hasFlag(args, "r", "recursive") || args.some((a) => isLongFlag(a, "recursive"));
  if (!recursive) {
    return null;
  }
  const targets = nonFlagArgs(args);
  if (targets.some(isCatastrophicTarget)) {
    return {
      risk: "high",
      reason: `recursive ${bin} on a system root path (${bin} ${args.join(" ")})`,
    };
  }
  return null;
}

function evaluateDd(args: string[]): SegmentFinding | null {
  const writesDevice = args.some((a) => {
    const lower = normalizeLowercaseStringOrEmpty(a);
    return lower.startsWith("of=/dev/") && lower !== "of=/dev/null";
  });
  if (writesDevice) {
    return { risk: "high", reason: `dd writing directly to a block device (${args.join(" ")})` };
  }
  return null;
}

function evaluateGit(args: string[]): SegmentFinding | null {
  const sub = nonFlagArgs(args)[0] ?? "";
  const forcePush =
    sub === "push" && args.some((a) => a === "--force" || a === "-f" || a === "--force-with-lease");
  if (forcePush) {
    return { risk: "medium", reason: "git force push (rewrites remote history)" };
  }
  if (sub === "reset" && args.some((a) => a === "--hard")) {
    return { risk: "medium", reason: "git reset --hard (discards local changes)" };
  }
  if (sub === "clean" && args.some((a) => shortClusterHas(a, "f"))) {
    return { risk: "medium", reason: "git clean -f (deletes untracked files)" };
  }
  if (sub === "filter-branch" || sub === "filter-repo") {
    return { risk: "medium", reason: `git ${sub} (rewrites history)` };
  }
  return null;
}

function evaluatePackageInstall(bin: string, args: string[]): SegmentFinding | null {
  const sub = nonFlagArgs(args)[0] ?? "";
  const isInstall = sub === "install" || sub === "i" || sub === "add" || sub === "global";
  const global = args.some((a) => a === "-g" || isLongFlag(a, "global"));
  if ((bin === "npm" || bin === "pnpm" || bin === "yarn") && isInstall && global) {
    return { risk: "medium", reason: `global package install (${bin} ${args.join(" ")})` };
  }
  if ((bin === "pip" || bin === "pip3") && sub === "install") {
    return { risk: "medium", reason: `pip install (system-wide package change)` };
  }
  if ((bin === "gem" && sub === "install") || (bin === "cargo" && sub === "install")) {
    return { risk: "medium", reason: `${bin} install (system-wide package change)` };
  }
  return null;
}

function evaluateSegment(segment: ExecCommandSegment): SegmentFinding[] {
  const findings: SegmentFinding[] = [];
  const bin = segmentBin(segment);
  const args = segment.argv.slice(1);

  if (bin.startsWith("mkfs")) {
    findings.push({ risk: "high", reason: `filesystem format (${bin})` });
  }
  if (POWER_BINS.has(bin) || (bin === "init" && (args[0] === "0" || args[0] === "6"))) {
    findings.push({ risk: "high", reason: `system power state change (${bin})` });
  }

  if (bin === "rm") {
    const f = evaluateRm(args);
    if (f) {
      findings.push(f);
    }
  }
  if (bin === "chmod" || bin === "chown") {
    const f = evaluateChmodChown(bin, args);
    if (f) {
      findings.push(f);
    }
  }
  if (bin === "dd") {
    const f = evaluateDd(args);
    if (f) {
      findings.push(f);
    }
  }
  if (bin === "git") {
    const f = evaluateGit(args);
    if (f) {
      findings.push(f);
    }
  }
  if (
    bin === "npm" ||
    bin === "pnpm" ||
    bin === "yarn" ||
    bin === "pip" ||
    bin === "pip3" ||
    bin === "gem" ||
    bin === "cargo"
  ) {
    const f = evaluatePackageInstall(bin, args);
    if (f) {
      findings.push(f);
    }
  }
  if (bin === "sudo" || bin === "doas") {
    findings.push({ risk: "medium", reason: `privilege escalation (${bin})` });
  }
  if (bin === "kill" && args.some((a) => a === "-9")) {
    findings.push({ risk: "medium", reason: "kill -9 (forced process termination)" });
  }
  if (bin === "killall" || bin === "pkill") {
    findings.push({ risk: "medium", reason: `${bin} (mass process termination)` });
  }
  if (bin === "shred" || bin === "wipe") {
    findings.push({ risk: "medium", reason: `${bin} (irreversible data destruction)` });
  }

  return findings;
}

/** Detect `curl|sh` / `wget|sh` style pipe-to-shell across piped segments. */
function evaluatePipeToShell(segments: ExecCommandSegment[]): SegmentFinding | null {
  const bins = segments.map(segmentBin);
  const hasFetch = bins.some((b) => FETCH_BINS.has(b));
  if (!hasFetch) {
    return null;
  }
  const pipesToBareShell = segments.some((segment) => {
    const bin = segmentBin(segment);
    if (!SHELL_BINS.has(bin)) {
      return false;
    }
    // Bare shell reading from stdin (no script file argument).
    const positional = nonFlagArgs(segment.argv.slice(1));
    return positional.length === 0;
  });
  if (pipesToBareShell) {
    return {
      risk: "high",
      reason: "piping downloaded content directly into a shell (curl|sh pattern)",
    };
  }
  return null;
}

export type SafeguardInput = {
  /**
   * Raw command string. Used for pattern checks that survive even when the
   * structured parse fails (fork bombs, device redirections), since such
   * commands can still execute through the raw shell path.
   */
  rawCommand?: string;
};

/**
 * Classify the system impact of a parsed shell command. Returns the highest
 * risk found across all segments plus the accumulated human-readable reasons.
 *
 * `analysis` may be `ok: false` (unparseable) — raw-string checks still apply
 * when `input.rawCommand` is provided.
 */
export function evaluateExecSafeguard(
  analysis: ExecCommandAnalysis,
  input?: SafeguardInput,
): SafeguardVerdict {
  const findings: SegmentFinding[] = [];

  const rawCommand = input?.rawCommand;
  if (rawCommand) {
    if (isForkBomb(rawCommand)) {
      findings.push({ risk: "high", reason: "fork bomb pattern detected" });
    }
    if (redirectsToBlockDevice(rawCommand)) {
      findings.push({ risk: "high", reason: "redirection overwriting a raw block device" });
    }
  }

  for (const segment of analysis.ok ? analysis.segments : []) {
    findings.push(...evaluateSegment(segment));
  }

  // Pipe-to-shell is evaluated per chain group (piped segments live together).
  const groups =
    analysis.chains && analysis.chains.length > 0 ? analysis.chains : [analysis.segments];
  for (const group of groups) {
    const f = evaluatePipeToShell(group);
    if (f) {
      findings.push(f);
    }
  }

  if (findings.length === 0) {
    return { risk: "low", reasons: [] };
  }

  let risk: SafeguardRisk = "low";
  for (const f of findings) {
    if (RISK_ORDER[f.risk] > RISK_ORDER[risk]) {
      risk = f.risk;
    }
  }

  // De-duplicate reasons while preserving order.
  const reasons = [...new Set(findings.map((f) => f.reason))];
  return { risk, reasons };
}
