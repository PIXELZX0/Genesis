import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearLiteralRedactionValuesForTest, redactLiteralSecrets } from "../../logging/redact.js";
import { resolveStoredSecretsPath } from "./ref.js";
import {
  deleteStoredSecret,
  getStoredSecretValue,
  isValidStoredSecretId,
  listStoredSecrets,
  primeStoredSecretRedaction,
  putStoredSecret,
} from "./store.js";

let tmpDir: string;
let env: NodeJS.ProcessEnv;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "genesis-stored-secrets-"));
  env = { ...process.env, GENESIS_OAUTH_DIR: tmpDir };
  clearLiteralRedactionValuesForTest();
});

afterEach(async () => {
  clearLiteralRedactionValuesForTest();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("stored secrets store", () => {
  it("validates ids as UPPER_SNAKE_CASE", () => {
    expect(isValidStoredSecretId("STRIPE_API_KEY")).toBe(true);
    expect(isValidStoredSecretId("stripe_api_key")).toBe(false);
    expect(isValidStoredSecretId("1_LEADING_DIGIT")).toBe(false);
    expect(isValidStoredSecretId("HAS-DASH")).toBe(false);
  });

  it("round-trips a value and keeps it out of the metadata listing", async () => {
    const metadata = await putStoredSecret({
      id: "STRIPE_API_KEY",
      value: "sk-live-abcdef123456",
      description: "Billing sync",
      requestedBy: { agentId: "main" },
      env,
    });
    expect(metadata).not.toHaveProperty("value");
    expect(metadata.description).toBe("Billing sync");

    expect(getStoredSecretValue("STRIPE_API_KEY", env)).toBe("sk-live-abcdef123456");

    const listed = listStoredSecrets(env);
    expect(listed).toHaveLength(1);
    expect(JSON.stringify(listed)).not.toContain("sk-live-abcdef123456");
  });

  it("preserves createdAt across updates", async () => {
    const first = await putStoredSecret({ id: "TOKEN_A", value: "value-one-abcdef", env });
    const second = await putStoredSecret({ id: "TOKEN_A", value: "value-two-abcdef", env });
    expect(second.createdAt).toBe(first.createdAt);
    expect(getStoredSecretValue("TOKEN_A", env)).toBe("value-two-abcdef");
  });

  it("rejects invalid ids and empty values", async () => {
    await expect(putStoredSecret({ id: "bad id", value: "x-abcdef", env })).rejects.toThrow(
      /UPPER_SNAKE_CASE/,
    );
    await expect(putStoredSecret({ id: "GOOD_ID", value: "", env })).rejects.toThrow(
      /not be empty/,
    );
  });

  it("deletes entries", async () => {
    await putStoredSecret({ id: "TOKEN_B", value: "value-abcdefgh", env });
    expect(await deleteStoredSecret("TOKEN_B", env)).toBe(true);
    expect(await deleteStoredSecret("TOKEN_B", env)).toBe(false);
    expect(getStoredSecretValue("TOKEN_B", env)).toBeUndefined();
  });

  it("registers stored values for exact-match redaction", async () => {
    await putStoredSecret({ id: "LEAKY_TOKEN", value: "totally-not-a-secret-value", env });
    expect(redactLiteralSecrets("echo totally-not-a-secret-value")).not.toContain(
      "totally-not-a-secret-value",
    );

    clearLiteralRedactionValuesForTest();
    expect(redactLiteralSecrets("echo totally-not-a-secret-value")).toContain(
      "totally-not-a-secret-value",
    );

    primeStoredSecretRedaction(env);
    expect(redactLiteralSecrets("echo totally-not-a-secret-value")).not.toContain(
      "totally-not-a-secret-value",
    );
  });

  it("writes the store to the credentials directory", () => {
    expect(resolveStoredSecretsPath(env)).toBe(path.join(tmpDir, "secrets.json"));
  });
});
