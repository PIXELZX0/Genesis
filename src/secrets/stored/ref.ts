import path from "node:path";
import { resolveOAuthDir } from "../../config/paths.js";
import type { FileSecretProviderConfig, SecretRef } from "../../config/types.secrets.js";

export const STORED_SECRETS_FILENAME = "secrets.json"; // pragma: allowlist secret

/**
 * Built-in provider alias for operator-supplied secrets captured through
 * `request_secret`. Backed by the `file` source so no new SecretRef source,
 * registry entry, or config surface is needed.
 */
export const STORED_SECRET_PROVIDER_ALIAS = "stored"; // pragma: allowlist secret

export function resolveStoredSecretsPath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolveOAuthDir(env), STORED_SECRETS_FILENAME);
}

/** JSON-pointer id addressing one stored secret's value. */
export function storedSecretRefId(id: string): string {
  return `/secrets/${id}/value`;
}

export function buildStoredSecretRef(id: string): SecretRef {
  return {
    source: "file",
    provider: STORED_SECRET_PROVIDER_ALIAS,
    id: storedSecretRefId(id),
  };
}

export function isStoredSecretRef(ref: SecretRef): boolean {
  return ref.source === "file" && ref.provider === STORED_SECRET_PROVIDER_ALIAS;
}

/** Provider config used when the operator has not declared `secrets.providers.stored`. */
export function builtinStoredSecretProviderConfig(
  env: NodeJS.ProcessEnv = process.env,
): FileSecretProviderConfig {
  return {
    source: "file",
    path: resolveStoredSecretsPath(env),
    mode: "json",
  };
}
