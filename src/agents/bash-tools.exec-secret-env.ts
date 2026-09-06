import { registerLiteralRedactionValue } from "../logging/redact.js";
import { getStoredSecretValue, isValidStoredSecretId } from "../secrets/stored/store.js";

const ENV_VAR_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;

export type ResolvedSecretEnv = {
  /** Real values, injected into the spawn env just before the process starts. */
  values: Record<string, string>;
  /** What the operator sees on the approval card and in tool params. */
  placeholders: Record<string, string>;
};

export function resolveExecSecretEnv(
  secretEnv: Record<string, string> | undefined,
): ResolvedSecretEnv | null {
  if (!secretEnv || Object.keys(secretEnv).length === 0) {
    return null;
  }
  const values: Record<string, string> = {};
  const placeholders: Record<string, string> = {};
  for (const [envVar, secretId] of Object.entries(secretEnv)) {
    if (!ENV_VAR_NAME_RE.test(envVar)) {
      throw new Error(`secretEnv key "${envVar}" is not a valid environment variable name.`);
    }
    if (!isValidStoredSecretId(secretId)) {
      throw new Error(
        `secretEnv["${envVar}"] must name a stored secret in UPPER_SNAKE_CASE (got "${secretId}").`,
      );
    }
    const value = getStoredSecretValue(secretId);
    if (!value) {
      throw new Error(
        `No stored secret named "${secretId}". Use the request_secret tool to ask the user for it first.`,
      );
    }
    // Registering here means an accidental echo of the value (printenv, a chatty
    // script) is masked before the tool result reaches the model or the UI.
    registerLiteralRedactionValue(value);
    values[envVar] = value;
    placeholders[envVar] = `<stored secret ${secretId}>`;
  }
  return { values, placeholders };
}
