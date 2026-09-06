import { isValidEnvSecretRefId } from "../../config/types.secrets.js";
import { withFileLock } from "../../infra/file-lock.js";
import { loadJsonFile, saveJsonFile } from "../../infra/json-file.js";
import { registerLiteralRedactionValue } from "../../logging/redact.js";
import { resolveStoredSecretsPath } from "./ref.js";

const STORED_SECRETS_VERSION = 1;

const STORED_SECRETS_LOCK_OPTIONS = {
  retries: {
    retries: 10,
    factor: 2,
    minTimeout: 100,
    maxTimeout: 10_000,
    randomize: true,
  },
  stale: 30_000,
} as const;

export type StoredSecretRequester = {
  agentId?: string;
  sessionKey?: string;
  channel?: string;
};

export type StoredSecretEntry = {
  id: string;
  value: string;
  description?: string;
  requestedBy?: StoredSecretRequester;
  createdAt: string;
  updatedAt: string;
};

/** Metadata view of a stored secret. Never carries the value. */
export type StoredSecretMetadata = Omit<StoredSecretEntry, "value">;

type StoredSecretsFile = {
  version: number;
  secrets: Record<string, StoredSecretEntry>;
};

export function isValidStoredSecretId(value: string): boolean {
  return isValidEnvSecretRefId(value);
}

export function assertValidStoredSecretId(value: string): void {
  if (!isValidStoredSecretId(value)) {
    throw new Error(
      `Stored secret name must be UPPER_SNAKE_CASE and match /^[A-Z][A-Z0-9_]{0,127}$/ (got "${value}").`,
    );
  }
}

function loadStoredSecretsFile(env?: NodeJS.ProcessEnv): StoredSecretsFile {
  const raw = loadJsonFile<StoredSecretsFile>(resolveStoredSecretsPath(env));
  if (!raw || typeof raw !== "object" || !raw.secrets || typeof raw.secrets !== "object") {
    return { version: STORED_SECRETS_VERSION, secrets: {} };
  }
  return { version: STORED_SECRETS_VERSION, secrets: raw.secrets };
}

function toMetadata(entry: StoredSecretEntry): StoredSecretMetadata {
  const { value: _value, ...rest } = entry;
  return rest;
}

export async function putStoredSecret(params: {
  id: string;
  value: string;
  description?: string;
  requestedBy?: StoredSecretRequester;
  env?: NodeJS.ProcessEnv;
}): Promise<StoredSecretMetadata> {
  assertValidStoredSecretId(params.id);
  if (!params.value) {
    throw new Error("Stored secret value must not be empty.");
  }
  const filePath = resolveStoredSecretsPath(params.env);
  return await withFileLock(filePath, STORED_SECRETS_LOCK_OPTIONS, async () => {
    const store = loadStoredSecretsFile(params.env);
    const now = new Date().toISOString();
    const previous = store.secrets[params.id];
    const entry: StoredSecretEntry = {
      id: params.id,
      value: params.value,
      ...(params.description ? { description: params.description } : {}),
      ...(params.requestedBy ? { requestedBy: params.requestedBy } : {}),
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
    };
    store.secrets[params.id] = entry;
    saveJsonFile(filePath, store);
    registerLiteralRedactionValue(params.value);
    return toMetadata(entry);
  });
}

export function getStoredSecretValue(id: string, env?: NodeJS.ProcessEnv): string | undefined {
  return loadStoredSecretsFile(env).secrets[id]?.value;
}

export function listStoredSecrets(env?: NodeJS.ProcessEnv): StoredSecretMetadata[] {
  return Object.values(loadStoredSecretsFile(env).secrets)
    .map(toMetadata)
    .toSorted((a, b) => a.id.localeCompare(b.id));
}

export async function deleteStoredSecret(id: string, env?: NodeJS.ProcessEnv): Promise<boolean> {
  const filePath = resolveStoredSecretsPath(env);
  return await withFileLock(filePath, STORED_SECRETS_LOCK_OPTIONS, async () => {
    const store = loadStoredSecretsFile(env);
    if (!store.secrets[id]) {
      return false;
    }
    delete store.secrets[id];
    saveJsonFile(filePath, store);
    return true;
  });
}

/**
 * Register every persisted value for exact-match redaction so an accidental
 * echo (printenv, a leaky script) is masked before tool output reaches the
 * model or the UI.
 */
export function primeStoredSecretRedaction(env?: NodeJS.ProcessEnv): void {
  for (const entry of Object.values(loadStoredSecretsFile(env).secrets)) {
    registerLiteralRedactionValue(entry.value);
  }
}
