import { Type } from "typebox";
import type { SecretRef } from "../../config/types.secrets.js";
import {
  DEFAULT_SECRET_REQUEST_TIMEOUT_MS,
  SECRET_REQUEST_DESCRIPTION_MAX_LENGTH,
  type SecretRequestStatus,
} from "../../infra/secret-requests.js";
import { isValidStoredSecretId } from "../../secrets/stored/store.js";
import { type AnyAgentTool, ToolInputError, readStringParam } from "./common.js";
import { callGatewayTool } from "./gateway.js";

// Registration must be fast; the operator-facing wait is a separate call.
const REQUEST_REGISTRATION_TIMEOUT_MS = 15_000;

const RequestSecretSchema = Type.Object({
  name: Type.String({
    pattern: "^[A-Z][A-Z0-9_]{0,127}$",
    description: 'UPPER_SNAKE_CASE name to file the value under (e.g. "STRIPE_API_KEY").',
  }),
  description: Type.String({
    minLength: 1,
    maxLength: SECRET_REQUEST_DESCRIPTION_MAX_LENGTH,
    description: "What the value is for. Shown to the user when they are asked for it.",
  }),
});

type RequestSecretContext = {
  agentId?: string;
  sessionKey?: string;
  turnSourceChannel?: string;
  turnSourceTo?: string;
  turnSourceAccountId?: string;
  turnSourceThreadId?: string | number;
};

function formatResult(params: {
  name: string;
  status: SecretRequestStatus;
  ref: SecretRef | null;
  undelivered?: boolean;
}): string {
  if (params.undelivered) {
    return [
      "No secret stored: the prompt could not be delivered to the user (no chat route and no approvals client).",
      "Do not ask for the value in chat. Tell the user to store it with `genesis secrets` instead.",
    ].join("\n");
  }
  if (params.status !== "provided" || !params.ref) {
    const reason =
      params.status === "cancelled" ? "declined the request" : "did not answer in time";
    return `No secret stored: the user ${reason}. Do not ask for the value in chat.`;
  }
  return [
    `Secret "${params.name}" is stored on the gateway.`,
    "The value was never sent to this conversation and you cannot read it.",
    `Reference it as: ${JSON.stringify(params.ref)}`,
    `To use it in a command, pass exec's secretEnv: {"SOME_ENV_VAR": "${params.name}"}.`,
  ].join("\n");
}

export function createRequestSecretTool(context?: RequestSecretContext): AnyAgentTool {
  return {
    label: "Request Secret",
    name: "request_secret",
    description:
      "Ask the user for a credential (API key, token, password). The value is captured by the gateway and stored server-side; it is never returned to you or added to this conversation. You get back a reference you can pass to other tools. Use this instead of asking for a secret in plain chat.",
    parameters: RequestSecretSchema,
    execute: async (toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const name = readStringParam(params, "name", { required: true });
      const description = readStringParam(params, "description", { required: true });
      if (!isValidStoredSecretId(name)) {
        throw new ToolInputError(
          "name must be UPPER_SNAKE_CASE and match /^[A-Z][A-Z0-9_]{0,127}$/",
        );
      }

      // Two-phase: the request id must exist server-side before the user can be
      // prompted, otherwise a fast `/secret` reply races the registration.
      const registration = (await callGatewayTool(
        "secret.request",
        { timeoutMs: REQUEST_REGISTRATION_TIMEOUT_MS },
        {
          name,
          description,
          agentId: context?.agentId,
          sessionKey: context?.sessionKey,
          toolCallId,
          turnSourceChannel: context?.turnSourceChannel,
          turnSourceTo: context?.turnSourceTo,
          turnSourceAccountId: context?.turnSourceAccountId,
          turnSourceThreadId: context?.turnSourceThreadId,
          twoPhase: true,
        },
        { expectFinal: false },
      )) as { id?: string; status?: string } | undefined;

      // The gateway only keeps the request pending when it found somewhere to
      // deliver it; otherwise it answers with a decision instead of "accepted".
      const id = typeof registration?.id === "string" ? registration.id : null;
      if (!id || registration?.status !== "accepted") {
        return {
          content: [
            {
              type: "text",
              text: formatResult({ name, status: "expired", ref: null, undelivered: true }),
            },
          ],
          details: { status: "expired" as const, name, undelivered: true },
        };
      }

      const waited = (await callGatewayTool(
        "secret.waitRequest",
        { timeoutMs: DEFAULT_SECRET_REQUEST_TIMEOUT_MS + 30_000 },
        { id },
      )) as { status?: string; ref?: SecretRef | null } | undefined;
      const status = (waited?.status ?? "expired") as SecretRequestStatus;
      const ref = waited?.ref ?? null;

      return {
        content: [{ type: "text", text: formatResult({ name, status, ref }) }],
        details: { status, name, ...(ref ? { ref } : {}) },
      };
    },
  };
}
