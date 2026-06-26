import type { ExecApprovalDecision } from "../infra/exec-approvals.js";
import type { ExecAsk, ExecHost, ExecSecurity, ExecTarget } from "../infra/exec-approvals.js";
import type { SafeBinProfileFixture } from "../infra/exec-safe-bin-policy.js";
import type { BashSandboxConfig } from "./bash-tools.shared.js";
import type { EmbeddedFullAccessBlockedReason } from "./pi-embedded-runner/types.js";

export type ExecToolDefaults = {
  hasCronTool?: boolean;
  host?: ExecTarget;
  security?: ExecSecurity;
  ask?: ExecAsk;
  trigger?: string;
  node?: string;
  pathPrepend?: string[];
  safeBins?: string[];
  strictInlineEval?: boolean;
  safeBinTrustedDirs?: string[];
  safeBinProfiles?: Record<string, SafeBinProfileFixture>;
  agentId?: string;
  backgroundMs?: number;
  timeoutSec?: number;
  approvalRunningNoticeMs?: number;
  sandbox?: BashSandboxConfig;
  elevated?: ExecElevatedDefaults;
  allowBackground?: boolean;
  scopeKey?: string;
  sessionKey?: string;
  messageProvider?: string;
  currentChannelId?: string;
  currentThreadTs?: string;
  accountId?: string;
  notifyOnExit?: boolean;
  notifyOnExitEmptySuccess?: boolean;
  cwd?: string;
  /** Command-impact safeguard (default: enabled). */
  safeguard?: ExecSafeguardDefaults;
};

export type ExecSafeguardDefaults = {
  enabled?: boolean;
  /** Stronger model ("provider/model") consulted for ambiguous commands. */
  model?: string;
  /** Max seconds to wait for the model verdict (default: 20). */
  timeoutSeconds?: number;
  /**
   * Injected evaluator that asks {@link model} to classify a command's impact.
   * Returns the raw model reply text (or null on error/no-model). Bound with
   * config + auth at tool-creation time so the exec tool stays decoupled from
   * the model runtime. Only invoked for commands the heuristics cannot clear.
   */
  evaluateCommandImpact?: (command: string, signal?: AbortSignal) => Promise<string | null>;
};

export type ExecElevatedDefaults = {
  enabled: boolean;
  allowed: boolean;
  defaultLevel: "on" | "off" | "ask" | "full";
  fullAccessAvailable?: boolean;
  fullAccessBlockedReason?: EmbeddedFullAccessBlockedReason;
};

export type ExecToolDetails =
  | {
      status: "running";
      sessionId: string;
      pid?: number;
      startedAt: number;
      cwd?: string;
      tail?: string;
    }
  | {
      status: "completed" | "failed";
      exitCode: number | null;
      durationMs: number;
      aggregated: string;
      timedOut?: boolean;
      cwd?: string;
    }
  | {
      status: "approval-pending";
      approvalId: string;
      approvalSlug: string;
      expiresAtMs: number;
      allowedDecisions?: readonly ExecApprovalDecision[];
      host: ExecHost;
      command: string;
      cwd?: string;
      nodeId?: string;
      warningText?: string;
    }
  | {
      status: "approval-unavailable";
      reason:
        | "initiating-platform-disabled"
        | "initiating-platform-unsupported"
        | "no-approval-route";
      channel?: string;
      channelLabel?: string;
      accountId?: string;
      sentApproverDms?: boolean;
      host: ExecHost;
      command: string;
      cwd?: string;
      nodeId?: string;
      warningText?: string;
    };
