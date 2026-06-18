import { newConnectionId } from "../reconnect.js";
import {
  formatError,
  getChildLogger,
  loadConfig,
  redactIdentifier,
  resolveWhatsAppHeartbeatRecipients,
  sendMessageWhatsApp,
  whatsappHeartbeatLog,
} from "./heartbeat-runner.runtime.js";

export async function runWebHeartbeatOnce(opts: {
  cfg?: ReturnType<typeof loadConfig>;
  to: string;
  verbose?: boolean;
  overrideBody?: string;
  dryRun?: boolean;
}) {
  const { cfg: cfgOverride, to, verbose = false, overrideBody, dryRun = false } = opts;
  const runId = newConnectionId();
  const redactedTo = redactIdentifier(to);
  const heartbeatLogger = getChildLogger({
    module: "web-heartbeat",
    runId,
    to: redactedTo,
  });
  const cfg = cfgOverride ?? loadConfig();

  if (overrideBody && overrideBody.trim().length === 0) {
    throw new Error("Override body must be non-empty when provided.");
  }

  try {
    if (overrideBody) {
      if (dryRun) {
        whatsappHeartbeatLog.info(
          `[dry-run] web send -> ${redactedTo} (${overrideBody.trim().length} chars, manual message)`,
        );
        return;
      }
      const sendResult = await sendMessageWhatsApp(to, overrideBody, { verbose, cfg });
      heartbeatLogger.info(
        {
          to: redactedTo,
          messageId: sendResult.messageId,
          chars: overrideBody.length,
          reason: "manual-message",
        },
        "manual heartbeat message sent",
      );
      whatsappHeartbeatLog.info(
        `manual heartbeat sent to ${redactedTo} (id ${sendResult.messageId})`,
      );
      return;
    }

    whatsappHeartbeatLog.info(`heartbeat skipped for ${redactedTo} (agent heartbeat removed)`);
  } catch (err) {
    const reason = formatError(err);
    heartbeatLogger.warn({ to: redactedTo, error: reason }, "heartbeat failed");
    whatsappHeartbeatLog.warn(`heartbeat failed (${reason})`);
    throw err;
  }
}

export function resolveHeartbeatRecipients(
  cfg: ReturnType<typeof loadConfig>,
  opts: { to?: string; all?: boolean; accountId?: string } = {},
) {
  return resolveWhatsAppHeartbeatRecipients(cfg, opts);
}
