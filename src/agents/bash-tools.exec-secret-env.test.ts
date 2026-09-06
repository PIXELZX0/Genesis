import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearLiteralRedactionValuesForTest, redactLiteralSecrets } from "../logging/redact.js";
import { putStoredSecret } from "../secrets/stored/store.js";
import { resolveExecSecretEnv } from "./bash-tools.exec-secret-env.js";

let tmpDir: string;
let previousOauthDir: string | undefined;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "genesis-exec-secret-env-"));
  previousOauthDir = process.env.GENESIS_OAUTH_DIR;
  process.env.GENESIS_OAUTH_DIR = tmpDir;
  clearLiteralRedactionValuesForTest();
});

afterEach(async () => {
  clearLiteralRedactionValuesForTest();
  if (previousOauthDir === undefined) {
    delete process.env.GENESIS_OAUTH_DIR;
  } else {
    process.env.GENESIS_OAUTH_DIR = previousOauthDir;
  }
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("resolveExecSecretEnv", () => {
  it("returns null when nothing is requested", () => {
    expect(resolveExecSecretEnv(undefined)).toBeNull();
    expect(resolveExecSecretEnv({})).toBeNull();
  });

  it("resolves values and hands back name-only placeholders", async () => {
    await putStoredSecret({ id: "STRIPE_API_KEY", value: "sk-live-abcdef123456" });
    const resolved = resolveExecSecretEnv({ STRIPE_KEY: "STRIPE_API_KEY" });
    expect(resolved?.values).toEqual({ STRIPE_KEY: "sk-live-abcdef123456" });
    expect(resolved?.placeholders).toEqual({ STRIPE_KEY: "<stored secret STRIPE_API_KEY>" });
    expect(JSON.stringify(resolved?.placeholders)).not.toContain("sk-live-abcdef123456");
  });

  it("registers resolved values for redaction so an echo is masked", async () => {
    await putStoredSecret({ id: "STRIPE_API_KEY", value: "sk-live-abcdef123456" });
    clearLiteralRedactionValuesForTest();
    resolveExecSecretEnv({ STRIPE_KEY: "STRIPE_API_KEY" });
    expect(redactLiteralSecrets("STRIPE_KEY=sk-live-abcdef123456")).not.toContain(
      "sk-live-abcdef123456",
    );
  });

  it("rejects bad env var names, bad secret names, and unknown secrets", async () => {
    await putStoredSecret({ id: "KNOWN_SECRET", value: "value-abcdefgh" });
    expect(() => resolveExecSecretEnv({ "BAD-NAME": "KNOWN_SECRET" })).toThrow(
      /valid environment variable name/,
    );
    expect(() => resolveExecSecretEnv({ OK_NAME: "lowercase" })).toThrow(/UPPER_SNAKE_CASE/);
    expect(() => resolveExecSecretEnv({ OK_NAME: "MISSING_SECRET" })).toThrow(/request_secret/);
  });
});
