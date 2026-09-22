import type { SecretRef } from "../config/types.secrets.js";

/**
 * A pending "give me a secret" prompt raised by the `request_secret` tool.
 *
 * The payload never carries the secret value: values travel only on
 * `secret.resolve` and are persisted server-side, so agent transcripts and
 * broadcast events see a reference at most.
 */
export type SecretRequestPayload = {
  /** UPPER_SNAKE_CASE stored-secret name the value will be filed under. */
  name: string;
  /** Operator-facing explanation of what the value is for. */
  description: string;
  agentId?: string | null;
  sessionKey?: string | null;
  toolCallId?: string | null;
  turnSourceChannel?: string | null;
  turnSourceTo?: string | null;
  turnSourceAccountId?: string | null;
  turnSourceThreadId?: string | number | null;
};

export type SecretRequest = {
  id: string;
  request: SecretRequestPayload;
  createdAtMs: number;
  expiresAtMs: number;
};

export type SecretRequestStatus = "provided" | "cancelled" | "expired";

export type SecretRequestResolved = {
  id: string;
  status: SecretRequestStatus;
  /** Handle the agent can pass to tools. Present only when status is "provided". */
  ref?: SecretRef | null;
  resolvedBy?: string | null;
  ts: number;
  request?: SecretRequestPayload;
};

// Fetching an API key from a dashboard takes longer than approving a command.
export const DEFAULT_SECRET_REQUEST_TIMEOUT_MS = 300_000;
export const MAX_SECRET_REQUEST_TIMEOUT_MS = 1_800_000;
export const SECRET_REQUEST_DESCRIPTION_MAX_LENGTH = 256;
export const SECRET_REQUEST_VALUE_MAX_LENGTH = 8192;

export function buildSecretRequestMessage(request: SecretRequest, nowMs: number): string {
  const secondsLeft = Math.max(0, Math.round((request.expiresAtMs - nowMs) / 1000));
  return [
    "🔑 Secret requested",
    `Name: ${request.request.name}`,
    `Purpose: ${request.request.description}`,
    `Expires in: ${secondsLeft}s`,
    "",
    `Reply "/secret ${request.request.name} <value>", or "/secret ${request.request.name}" and send the value in your next message.`,
    `Reply "/secret ${request.request.name} cancel" to decline.`,
    "The value is stored on the gateway and is never added to the agent transcript.",
  ].join("\n");
}

export function buildSecretRequestResolvedMessage(resolved: SecretRequestResolved): string {
  const name = resolved.request?.name ?? resolved.id;
  if (resolved.status === "provided") {
    return `🔑 Secret ${name} stored.`;
  }
  if (resolved.status === "cancelled") {
    return `🔑 Secret ${name} declined.`;
  }
  return `🔑 Secret ${name} request expired.`;
}
