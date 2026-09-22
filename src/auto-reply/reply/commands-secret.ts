import { callGateway } from "../../gateway/call.js";
import { GATEWAY_CLIENT_MODES, GATEWAY_CLIENT_NAMES } from "../../gateway/protocol/client-info.js";
import { logVerbose } from "../../globals.js";
import { resolveApprovalCommandAuthorization } from "../../infra/channel-approval-auth.js";
import { formatErrorMessage } from "../../infra/errors.js";
import { isValidStoredSecretId } from "../../secrets/stored/store.js";
import { normalizeOptionalString } from "../../shared/string-coerce.js";
import { resolveChannelAccountId } from "./channel-context.js";
import { requireGatewayClientScopeForInternalChannel } from "./command-gates.js";
import type { CommandHandler, HandleCommandsParams } from "./commands-types.js";

const COMMAND_REGEX = /^\/?secret(?:\s|$)/i;
const USAGE_TEXT =
  'Usage: /secret <NAME> <value> to store directly, or /secret <NAME> then send the value in your next message. "/secret <NAME> cancel" declines.';

/**
 * Armed captures, keyed by who is answering where. The next message from that
 * sender in that session is consumed as the secret value instead of being
 * handed to the agent, so the value never reaches the transcript.
 */
const pendingCaptures = new Map<string, { name: string; armedAtMs: number }>();

// Long enough to paste from a password manager, short enough that a forgotten
// capture does not silently swallow a later message.
const CAPTURE_TTL_MS = 10 * 60 * 1000;

function captureKey(params: HandleCommandsParams): string {
  return [
    params.command.channel,
    params.command.senderId ?? "",
    params.sessionKey,
    params.command.to ?? "",
  ].join("|");
}

function isAuthorized(params: HandleCommandsParams): boolean {
  if (params.command.isAuthorizedSender) {
    return true;
  }
  const authorization = resolveApprovalCommandAuthorization({
    cfg: params.cfg,
    channel: params.command.channel,
    accountId: resolveChannelAccountId({
      cfg: params.cfg,
      ctx: params.ctx,
      command: params.command,
    }),
    senderId: params.command.senderId,
    kind: "plugin",
  });
  return authorization.explicit && authorization.authorized;
}

async function submitSecretResolution(params: {
  handlerParams: HandleCommandsParams;
  name: string;
  action: "provide" | "cancel";
  value?: string;
}): Promise<string | null> {
  const resolvedBy = `${params.handlerParams.command.channel}:${
    params.handlerParams.command.senderId ?? "unknown"
  }`;
  try {
    await callGateway({
      method: "secret.resolve",
      // The gateway accepts the stored-secret name here and matches it against
      // its pending requests, so the user never has to copy a request id.
      params: {
        id: params.name,
        action: params.action,
        ...(params.value ? { value: params.value } : {}),
      },
      clientName: GATEWAY_CLIENT_NAMES.GATEWAY_CLIENT,
      clientDisplayName: `Chat secret (${resolvedBy})`,
      mode: GATEWAY_CLIENT_MODES.BACKEND,
    });
    return null;
  } catch (error) {
    return formatErrorMessage(error);
  }
}

function storedReplyText(name: string): string {
  return `✅ Stored ${name}. The value was not added to the conversation. Delete your message if the platform kept it.`;
}

/** Best-effort removal of the message carrying the raw value. */
async function tryDeleteCapturedMessage(params: HandleCommandsParams): Promise<void> {
  const ctx = params.ctx;
  const messageId = normalizeOptionalString(ctx.MessageSidFull ?? ctx.MessageSid);
  const to = normalizeOptionalString(ctx.OriginatingTo ?? params.command.to);
  if (!messageId || !to) {
    return;
  }
  try {
    const { runMessageAction } = await import("../../infra/outbound/message-action-runner.js");
    await runMessageAction({
      cfg: params.cfg,
      action: "delete",
      params: { channel: params.command.channel, to, messageId },
      sessionKey: params.sessionKey,
      agentId: params.agentId,
    });
  } catch (error) {
    // Deletion is a courtesy, not a guarantee: the platform may not support it
    // or may retain the message anyway.
    logVerbose(`/secret: could not delete captured message: ${formatErrorMessage(error)}`);
  }
}

export const handleSecretCommand: CommandHandler = async (params, allowTextCommands) => {
  if (!allowTextCommands) {
    return null;
  }
  const key = captureKey(params);
  const armed = pendingCaptures.get(key);
  if (armed) {
    if (Date.now() - armed.armedAtMs > CAPTURE_TTL_MS) {
      pendingCaptures.delete(key);
    } else {
      pendingCaptures.delete(key);
      // Group bodies may carry a leading bot mention; the stripped command body drops it.
      const value = (
        params.isGroup ? params.command.commandBodyNormalized : params.command.rawBodyNormalized
      ).trim();
      if (!value) {
        return {
          shouldContinue: false,
          reply: { text: `❌ Empty value; secret ${armed.name} was not stored.` },
        };
      }
      const error = await submitSecretResolution({
        handlerParams: params,
        name: armed.name,
        action: "provide",
        value,
      });
      await tryDeleteCapturedMessage(params);
      if (error) {
        return { shouldContinue: false, reply: { text: `❌ Failed to store secret: ${error}` } };
      }
      return {
        shouldContinue: false,
        reply: { text: storedReplyText(armed.name) },
      };
    }
  }

  const trimmed = params.command.commandBodyNormalized.trim();
  const commandMatch = trimmed.match(COMMAND_REGEX);
  if (!commandMatch) {
    return null;
  }
  const tokens = trimmed.slice(commandMatch[0].length).trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) {
    return { shouldContinue: false, reply: { text: USAGE_TEXT } };
  }
  const name = tokens[0];
  if (!isValidStoredSecretId(name)) {
    return {
      shouldContinue: false,
      reply: { text: `❌ "${name}" is not a valid secret name (UPPER_SNAKE_CASE).` },
    };
  }

  if (!isAuthorized(params)) {
    logVerbose(
      `Ignoring /secret from unauthorized sender: ${params.command.senderId || "<unknown>"}`,
    );
    return { shouldContinue: false };
  }
  const missingScope = requireGatewayClientScopeForInternalChannel(params, {
    label: "/secret",
    allowedScopes: ["operator.approvals", "operator.admin"],
    missingText: "❌ /secret requires operator.approvals for gateway clients.",
  });
  if (missingScope) {
    return missingScope;
  }

  if (tokens[1]?.toLowerCase() === "cancel") {
    pendingCaptures.delete(key);
    const error = await submitSecretResolution({
      handlerParams: params,
      name,
      action: "cancel",
    });
    if (error) {
      return { shouldContinue: false, reply: { text: `❌ Failed to cancel: ${error}` } };
    }
    return { shouldContinue: false, reply: { text: `🔑 Declined ${name}.` } };
  }

  // One-shot "/secret NAME value": a plain follow-up message can be dropped by
  // channel gating (e.g. Matrix rooms require a mention unless it is a command).
  const inlineValue = tokens[1]
    ? trimmed.slice(commandMatch[0].length).trim().slice(name.length).trim()
    : "";
  if (inlineValue) {
    pendingCaptures.delete(key);
    const error = await submitSecretResolution({
      handlerParams: params,
      name,
      action: "provide",
      value: inlineValue,
    });
    await tryDeleteCapturedMessage(params);
    if (error) {
      return { shouldContinue: false, reply: { text: `❌ Failed to store secret: ${error}` } };
    }
    return { shouldContinue: false, reply: { text: storedReplyText(name) } };
  }

  pendingCaptures.set(key, { name, armedAtMs: Date.now() });
  return {
    shouldContinue: false,
    reply: {
      text: `🔑 Send the value for ${name} in your next message, or send "/secret ${name} <value>" (needed in group rooms that require a mention). It is stored on the gateway and never added to the conversation. Send "/secret ${name} cancel" to abort.`,
    },
  };
};

/** Test-only: drop every armed capture. */
export function clearPendingSecretCapturesForTest(): void {
  pendingCaptures.clear();
}
