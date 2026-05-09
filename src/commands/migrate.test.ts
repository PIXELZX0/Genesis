import { describe, expect, it } from "vitest";
import {
  buildHermesGenesisConfig,
  collectHermesAuthProfiles,
  mergeDotEnvRaw,
  transformOpenClawConfig,
} from "./migrate.js";

describe("OpenClaw migration helpers", () => {
  it("rewrites OpenClaw paths and env references for Genesis", () => {
    const result = transformOpenClawConfig(
      {
        agents: {
          defaults: {
            workspace: "~/.openclaw/workspace",
            systemPromptOverride: "Use ${OPENCLAW_GATEWAY_TOKEN} for tests.",
          },
        },
        env: {
          vars: {
            OPENCLAW_GATEWAY_TOKEN: "token-ref",
            PROJECT_PATH: "/Users/me/.openclaw/project",
          },
        },
      },
      {
        sourceDir: "/Users/me/.openclaw",
        targetDir: "/Users/me/.genesis",
      },
    );

    expect(result).toEqual({
      agents: {
        defaults: {
          workspace: "~/.genesis/workspace",
          systemPromptOverride: "Use ${GENESIS_GATEWAY_TOKEN} for tests.",
        },
      },
      env: {
        vars: {
          GENESIS_GATEWAY_TOKEN: "token-ref",
          PROJECT_PATH: "/Users/me/.genesis/project",
        },
      },
    });
  });
});

describe("Hermes migration helpers", () => {
  it("maps Hermes model, fallback model, providers, timezone, and workspace", () => {
    const result = buildHermesGenesisConfig({
      baseConfig: {
        agents: {
          defaults: {
            model: "openai/gpt-5.4",
          },
        },
      },
      targetStateDir: "/tmp/genesis",
      hermesConfig: {
        model: {
          provider: "openrouter",
          model: "anthropic/claude-sonnet-4-6",
        },
        fallback_model: [{ provider: "gemini", model: "gemini-3.1-pro-preview" }],
        timezone: "Asia/Seoul",
        terminal: { cwd: "~/work" },
        providers: {
          local: {
            base_url: "http://127.0.0.1:8000/v1",
            key_env: "LOCAL_API_KEY",
            default_model: "local-model",
          },
        },
      },
      force: true,
    });

    expect(result.config.agents?.defaults?.model).toEqual({
      primary: "openrouter/anthropic/claude-sonnet-4-6",
      fallbacks: ["google/gemini-3.1-pro-preview"],
    });
    expect(result.config.agents?.defaults?.userTimezone).toBe("Asia/Seoul");
    expect(result.config.agents?.defaults?.workspace).toContain("/work");
    expect(result.config.models?.providers?.local).toMatchObject({
      baseUrl: "http://127.0.0.1:8000/v1",
      apiKey: { source: "env", provider: "default", id: "LOCAL_API_KEY" },
      models: [
        expect.objectContaining({
          id: "local-model",
          api: "openai-completions",
          metadataSource: "models-add",
        }),
      ],
    });
  });

  it("keeps existing Genesis model defaults unless force is enabled", () => {
    const result = buildHermesGenesisConfig({
      baseConfig: {
        agents: {
          defaults: {
            model: "openai/gpt-5.4",
          },
        },
      },
      targetStateDir: "/tmp/genesis",
      hermesConfig: {
        model: { provider: "openrouter", model: "anthropic/claude-sonnet-4-6" },
      },
    });

    expect(result.config.agents?.defaults?.model).toBe("openai/gpt-5.4");
    expect(result.config.agents?.defaults?.models).toHaveProperty(
      "openrouter/anthropic/claude-sonnet-4-6",
    );
  });

  it("collects Hermes API-key credentials and downgrades OAuth entries to static tokens", () => {
    const profiles = collectHermesAuthProfiles({
      providers: {
        nous: {
          auth_type: "oauth",
          access_token: "oauth-access",
          expires_at_ms: 1_800_000_000_000,
          label: "portal",
        },
      },
      credential_pool: {
        openrouter: [
          {
            id: "primary",
            auth_type: "api_key",
            access_token: "sk-or-test",
            label: "main",
          },
        ],
      },
    });

    expect(profiles).toHaveLength(2);
    expect(profiles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          profileId: expect.stringMatching(/^openrouter:hermes-/u),
          credential: expect.objectContaining({
            type: "api_key",
            provider: "openrouter",
            key: "sk-or-test",
          }),
        }),
        expect.objectContaining({
          profileId: expect.stringMatching(/^nous:hermes-/u),
          credential: expect.objectContaining({
            type: "token",
            provider: "nous",
            token: "oauth-access",
            expires: 1_800_000_000_000,
          }),
        }),
      ]),
    );
  });
});

describe("dotenv migration helpers", () => {
  it("preserves existing values unless force is enabled", () => {
    const result = mergeDotEnvRaw({
      targetRaw: "OPENAI_API_KEY=old\n",
      entries: {
        OPENAI_API_KEY: "new",
        OPENROUTER_API_KEY: "router key",
      },
    });

    expect(result.raw).toBe('OPENAI_API_KEY=old\nOPENROUTER_API_KEY="router key"\n');
    expect(result.skipped).toEqual(["OPENAI_API_KEY"]);
    expect(result.added).toEqual(["OPENROUTER_API_KEY"]);
  });

  it("replaces existing values with force", () => {
    const result = mergeDotEnvRaw({
      targetRaw: "OPENAI_API_KEY=old\n",
      entries: {
        OPENAI_API_KEY: "new",
      },
      force: true,
    });

    expect(result.raw).toBe("OPENAI_API_KEY=new\n");
    expect(result.replaced).toEqual(["OPENAI_API_KEY"]);
  });
});
