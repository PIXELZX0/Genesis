import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { GenesisConfig } from "../../config/types.genesis.js";
import { resolveSecretRefString } from "../resolve.js";
import { buildStoredSecretRef, isStoredSecretRef } from "./ref.js";
import { putStoredSecret } from "./store.js";

let tmpDir: string;
let env: NodeJS.ProcessEnv;
let previousOauthDir: string | undefined;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "genesis-stored-ref-"));
  previousOauthDir = process.env.GENESIS_OAUTH_DIR;
  // The built-in provider resolves its path from ambient env, so point the
  // whole process at the temp credentials dir for this test.
  process.env.GENESIS_OAUTH_DIR = tmpDir;
  env = { ...process.env };
});

afterEach(async () => {
  if (previousOauthDir === undefined) {
    delete process.env.GENESIS_OAUTH_DIR;
  } else {
    process.env.GENESIS_OAUTH_DIR = previousOauthDir;
  }
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("stored secret refs", () => {
  it("builds a file-source ref addressing the stored value", () => {
    const ref = buildStoredSecretRef("STRIPE_API_KEY");
    expect(ref).toEqual({
      source: "file",
      provider: "stored",
      id: "/secrets/STRIPE_API_KEY/value",
    });
    expect(isStoredSecretRef(ref)).toBe(true);
    expect(isStoredSecretRef({ source: "env", provider: "default", id: "X" })).toBe(false);
  });

  it("resolves through the built-in provider with no operator config", async () => {
    await putStoredSecret({ id: "STRIPE_API_KEY", value: "sk-live-abcdef123456", env });
    const value = await resolveSecretRefString(buildStoredSecretRef("STRIPE_API_KEY"), {
      config: {} as GenesisConfig,
      env,
    });
    expect(value).toBe("sk-live-abcdef123456");
  });
});
