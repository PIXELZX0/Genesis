import { randomUUID } from "node:crypto";
import type { ExecApprovalForwarder } from "../../infra/exec-approval-forwarder.js";
import type { SecretRequestPayload, SecretRequestStatus } from "../../infra/secret-requests.js";
import {
  DEFAULT_SECRET_REQUEST_TIMEOUT_MS,
  MAX_SECRET_REQUEST_TIMEOUT_MS,
} from "../../infra/secret-requests.js";
import { buildStoredSecretRef } from "../../secrets/stored/ref.js";
import { putStoredSecret } from "../../secrets/stored/store.js";
import { normalizeOptionalString } from "../../shared/string-coerce.js";
import type { ExecApprovalManager } from "../exec-approval-manager.js";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  validateSecretRequestParams,
  validateSecretResolveParams,
  validateSecretWaitRequestParams,
} from "../protocol/index.js";
import {
  handleApprovalResolve,
  handlePendingApprovalRequest,
  respondPendingApprovalLookupError,
  resolvePendingApprovalRecord,
} from "./approval-shared.js";
import type { GatewayRequestHandlers } from "./types.js";

export type SecretRequestManager = ExecApprovalManager<SecretRequestPayload>;

/**
 * Map the approval decision vocabulary onto secret-request outcomes. The
 * manager is reused verbatim so pending/expiry/idempotency semantics stay
 * identical to exec and plugin approvals.
 */
function toRequestStatus(decision: string | null): SecretRequestStatus {
  if (decision === "allow-once") {
    return "provided";
  }
  if (decision === "deny") {
    return "cancelled";
  }
  return "expired";
}

export function createSecretRequestHandlers(
  manager: SecretRequestManager,
  opts?: { forwarder?: ExecApprovalForwarder },
): GatewayRequestHandlers {
  return {
    "secret.request": async ({ params, client, respond, context }) => {
      if (!validateSecretRequestParams(params)) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `invalid secret.request params: ${formatValidationErrors(
              validateSecretRequestParams.errors,
            )}`,
          ),
        );
        return;
      }
      const p = params as {
        name: string;
        description: string;
        agentId?: string;
        sessionKey?: string;
        toolCallId?: string;
        turnSourceChannel?: string;
        turnSourceTo?: string;
        turnSourceAccountId?: string;
        turnSourceThreadId?: string | number;
        timeoutMs?: number;
        twoPhase?: boolean;
      };
      const timeoutMs = Math.min(
        typeof p.timeoutMs === "number" ? p.timeoutMs : DEFAULT_SECRET_REQUEST_TIMEOUT_MS,
        MAX_SECRET_REQUEST_TIMEOUT_MS,
      );
      const trimmed = (value?: string | null): string | null =>
        normalizeOptionalString(value) || null;

      const request: SecretRequestPayload = {
        name: p.name,
        description: p.description,
        agentId: p.agentId ?? null,
        sessionKey: p.sessionKey ?? null,
        toolCallId: p.toolCallId ?? null,
        turnSourceChannel: trimmed(p.turnSourceChannel),
        turnSourceTo: trimmed(p.turnSourceTo),
        turnSourceAccountId: trimmed(p.turnSourceAccountId),
        turnSourceThreadId: p.turnSourceThreadId ?? null,
      };

      // Server-generated, kind-prefixed id so chat command routing can tell
      // secret prompts apart from exec/plugin approvals.
      const record = manager.create(request, timeoutMs, `secret:${randomUUID()}`);
      let decisionPromise: Promise<string | null>;
      try {
        decisionPromise = manager.register(record, timeoutMs);
      } catch (err) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, `registration failed: ${String(err)}`),
        );
        return;
      }

      const requestEvent = {
        id: record.id,
        request: record.request,
        createdAtMs: record.createdAtMs,
        expiresAtMs: record.expiresAtMs,
      };

      await handlePendingApprovalRequest({
        manager,
        record,
        decisionPromise: decisionPromise as Promise<never>,
        respond,
        context,
        clientConnId: client?.connId,
        requestEventName: "secret.requested",
        requestEvent,
        twoPhase: p.twoPhase === true,
        deliverRequest: () => {
          if (!opts?.forwarder?.handleSecretRequested) {
            return false;
          }
          return opts.forwarder.handleSecretRequested(requestEvent).catch((err) => {
            context.logGateway?.error?.(`secret requests: forward request failed: ${String(err)}`);
            return false;
          });
        },
      });
    },

    "secret.waitRequest": async ({ params, respond }) => {
      if (!validateSecretWaitRequestParams(params)) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `invalid secret.waitRequest params: ${formatValidationErrors(
              validateSecretWaitRequestParams.errors,
            )}`,
          ),
        );
        return;
      }
      const id = (params as { id: string }).id;
      const decisionPromise = manager.awaitDecision(id);
      if (!decisionPromise) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "secret request expired or not found"),
        );
        return;
      }
      const snapshot = manager.getSnapshot(id);
      const status = toRequestStatus(await decisionPromise);
      respond(
        true,
        {
          id,
          status,
          // The handle, never the value.
          ref:
            status === "provided" && snapshot ? buildStoredSecretRef(snapshot.request.name) : null,
        },
        undefined,
      );
    },

    "secret.resolve": async ({ params, respond, client, context }) => {
      if (!validateSecretResolveParams(params)) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `invalid secret.resolve params: ${formatValidationErrors(
              validateSecretResolveParams.errors,
            )}`,
          ),
        );
        return;
      }
      const p = params as { id: string; action: "provide" | "cancel"; value?: string };
      // Chat clients answer with the secret name ("STRIPE_API_KEY"), not the
      // opaque request id, so fall back to matching pending requests by name.
      const inputId =
        manager.lookupPendingId(p.id).kind === "none"
          ? (manager.listPendingRecords().findLast((record) => record.request.name === p.id)?.id ??
            p.id)
          : p.id;
      const pending = resolvePendingApprovalRecord({ manager, inputId });
      if (!pending.ok) {
        respondPendingApprovalLookupError({ respond, response: pending.response });
        return;
      }

      if (p.action === "provide") {
        if (!p.value) {
          respond(
            false,
            undefined,
            errorShape(ErrorCodes.INVALID_REQUEST, 'value is required for action "provide"'),
          );
          return;
        }
        try {
          await putStoredSecret({
            id: pending.snapshot.request.name,
            value: p.value,
            description: pending.snapshot.request.description,
            requestedBy: {
              ...(pending.snapshot.request.agentId
                ? { agentId: pending.snapshot.request.agentId }
                : {}),
              ...(pending.snapshot.request.sessionKey
                ? { sessionKey: pending.snapshot.request.sessionKey }
                : {}),
              ...(pending.snapshot.request.turnSourceChannel
                ? { channel: pending.snapshot.request.turnSourceChannel }
                : {}),
            },
          });
        } catch (err) {
          respond(
            false,
            undefined,
            errorShape(ErrorCodes.INVALID_REQUEST, `failed to store secret: ${String(err)}`),
          );
          return;
        }
      }

      await handleApprovalResolve({
        manager,
        inputId: pending.approvalId,
        decision: p.action === "provide" ? "allow-once" : "deny",
        respond,
        context,
        client,
        exposeAmbiguousPrefixError: false,
        resolvedEventName: "secret.resolved",
        // Values are deliberately absent here: this event fans out to every
        // approvals-scoped client and to channel forwarders.
        buildResolvedEvent: ({ approvalId, decision, resolvedBy, snapshot, nowMs }) => ({
          id: approvalId,
          status: toRequestStatus(decision),
          ref: decision === "allow-once" ? buildStoredSecretRef(snapshot.request.name) : null,
          resolvedBy,
          ts: nowMs,
          request: snapshot.request,
        }),
        forwardResolved: (resolvedEvent) => opts?.forwarder?.handleSecretResolved?.(resolvedEvent),
        forwardResolvedErrorLabel: "secret requests: forward resolve failed",
      });
    },
  };
}
