import path from "node:path";
import { resolveMainSessionKey } from "../config/sessions/main-session.js";
import type { GenesisConfig } from "../config/types.genesis.js";
import { enqueueSystemEvent } from "../infra/system-events.js";

export type ConfigRecoveryNoticePhase = "startup" | "reload";

export function formatConfigRecoveryNotice(params: {
  phase: ConfigRecoveryNoticePhase;
  reason: string;
  configPath: string;
}): string {
  const configName = path.basename(params.configPath) || "genesis.json";
  return [
    `Config recovery warning: Genesis restored ${configName} from the last-known-good backup during ${params.phase} (${params.reason}).`,
    "The rejected config was invalid and was preserved as a timestamped .clobbered.* file.",
    `Do not write ${configName} again unless you validate the full config first.`,
  ].join(" ");
}

export function enqueueConfigRecoveryNotice(params: {
  cfg: GenesisConfig;
  phase: ConfigRecoveryNoticePhase;
  reason: string;
  configPath: string;
}): boolean {
  return enqueueSystemEvent(formatConfigRecoveryNotice(params), {
    sessionKey: resolveMainSessionKey(params.cfg),
    contextKey: `config-recovery:${params.phase}:${params.reason}`,
  });
}
