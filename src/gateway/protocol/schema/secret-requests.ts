import { Type } from "typebox";
import {
  MAX_SECRET_REQUEST_TIMEOUT_MS,
  SECRET_REQUEST_DESCRIPTION_MAX_LENGTH,
  SECRET_REQUEST_VALUE_MAX_LENGTH,
} from "../../../infra/secret-requests.js";
import { NonEmptyString } from "./primitives.js";

const StoredSecretName = Type.String({ pattern: "^[A-Z][A-Z0-9_]{0,127}$" });

export const SecretRequestParamsSchema = Type.Object(
  {
    name: StoredSecretName,
    description: Type.String({
      minLength: 1,
      maxLength: SECRET_REQUEST_DESCRIPTION_MAX_LENGTH,
    }),
    agentId: Type.Optional(Type.String()),
    sessionKey: Type.Optional(Type.String()),
    toolCallId: Type.Optional(Type.String()),
    turnSourceChannel: Type.Optional(Type.String()),
    turnSourceTo: Type.Optional(Type.String()),
    turnSourceAccountId: Type.Optional(Type.String()),
    turnSourceThreadId: Type.Optional(Type.Union([Type.String(), Type.Number()])),
    timeoutMs: Type.Optional(Type.Integer({ minimum: 1, maximum: MAX_SECRET_REQUEST_TIMEOUT_MS })),
    twoPhase: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

export const SecretWaitRequestParamsSchema = Type.Object(
  { id: NonEmptyString },
  { additionalProperties: false },
);

export const SecretResolveParamsSchema = Type.Object(
  {
    id: NonEmptyString,
    action: Type.String({ enum: ["provide", "cancel"] }),
    // Only present for action="provide". This is the single path a secret value
    // travels on; it is never echoed back in results or broadcast events.
    value: Type.Optional(Type.String({ minLength: 1, maxLength: SECRET_REQUEST_VALUE_MAX_LENGTH })),
  },
  { additionalProperties: false },
);
