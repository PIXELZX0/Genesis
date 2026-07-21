import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { resolveBedrockConfigApiKey } from "./config-api-key.js";

const readSibling = (name: string) =>
  readFileSync(fileURLToPath(new URL(name, import.meta.url)), "utf8");

describe("resolveBedrockConfigApiKey", () => {
  it("falls back to undefined when no AWS auth env marker is present", () => {
    expect(resolveBedrockConfigApiKey({} as NodeJS.ProcessEnv)).toBeUndefined();
  });

  it("resolves the AWS SDK env var name when present", () => {
    expect(resolveBedrockConfigApiKey({ AWS_PROFILE: "default" } as NodeJS.ProcessEnv)).toBe(
      "AWS_PROFILE",
    );
  });
});

describe("setup-api light-surface contract", () => {
  it("does not import discovery.ts (which pulls the lazily-installed @aws-sdk/client-bedrock)", () => {
    const source = readSibling("setup-api.ts");
    expect(source).not.toMatch(/from\s+["']\.\/discovery\.js["']/);
  });

  it("config-api-key.ts itself has no AWS SDK import", () => {
    const source = readSibling("config-api-key.ts");
    expect(source).not.toMatch(/@aws-sdk/);
  });
});
