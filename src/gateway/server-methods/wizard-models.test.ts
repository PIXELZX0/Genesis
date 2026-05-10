import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GenesisConfig } from "../../config/types.genesis.js";
import type { ProviderAuthChoiceMetadata } from "../../plugins/provider-auth-choices.js";
import type { ProviderAuthMethod, ProviderPlugin } from "../../plugins/types.js";
import type { WizardPrompter, WizardSelectParams } from "../../wizard/prompts.js";

const mocks = vi.hoisted(() => ({
  readConfigFileSnapshot: vi.fn(),
  replaceConfigFile: vi.fn(async () => {}),
  resolveManifestProviderAuthChoices: vi.fn<() => ProviderAuthChoiceMetadata[]>(() => []),
  resolvePluginProviders: vi.fn<() => ProviderPlugin[]>(() => []),
  runProviderPluginAuthMethod: vi.fn(),
  runProviderModelSelectedHook: vi.fn(async () => {}),
  invalidateModelAuthStatusCache: vi.fn(),
}));

vi.mock("../../config/config.js", () => ({
  readConfigFileSnapshot: mocks.readConfigFileSnapshot,
  replaceConfigFile: mocks.replaceConfigFile,
}));

vi.mock("../../plugins/provider-auth-choices.js", () => ({
  resolveManifestProviderAuthChoices: mocks.resolveManifestProviderAuthChoices,
}));

vi.mock("../../plugins/providers.runtime.js", () => ({
  resolvePluginProviders: mocks.resolvePluginProviders,
}));

vi.mock("../../plugins/provider-auth-choice.js", () => ({
  runProviderPluginAuthMethod: mocks.runProviderPluginAuthMethod,
}));

vi.mock("../../plugins/provider-auth-choice.runtime.js", () => ({
  runProviderModelSelectedHook: mocks.runProviderModelSelectedHook,
}));

vi.mock("./models-auth-status.js", () => ({
  invalidateModelAuthStatusCache: mocks.invalidateModelAuthStatusCache,
}));

import { runModelProviderWizard } from "./wizard-models.js";

function createChoice(params: {
  pluginId?: string;
  providerId: string;
  methodId: string;
  choiceId: string;
  choiceLabel: string;
  groupLabel?: string;
}): ProviderAuthChoiceMetadata {
  return {
    pluginId: params.pluginId ?? params.providerId,
    providerId: params.providerId,
    methodId: params.methodId,
    choiceId: params.choiceId,
    choiceLabel: params.choiceLabel,
    groupId: params.providerId,
    groupLabel: params.groupLabel ?? params.choiceLabel,
  };
}

function createProvider(params: {
  providerId: string;
  providerLabel: string;
  methodId: string;
  choiceId: string;
}): ProviderPlugin {
  const method: ProviderAuthMethod = {
    id: params.methodId,
    label: `${params.providerLabel} auth`,
    kind: "api_key",
    wizard: {
      choiceId: params.choiceId,
      choiceLabel: `${params.providerLabel} auth`,
    },
    run: async () => ({ profiles: [] }),
  };
  return {
    id: params.providerId,
    label: params.providerLabel,
    auth: [method],
  };
}

function createPrompter(select: WizardPrompter["select"]): WizardPrompter {
  return {
    intro: vi.fn(async () => {}),
    outro: vi.fn(async () => {}),
    note: vi.fn(async () => {}),
    select,
    multiselect: vi.fn(async () => []),
    text: vi.fn(async () => ""),
    confirm: vi.fn(async () => true),
    progress: vi.fn(() => ({
      update: vi.fn(),
      stop: vi.fn(),
    })),
  };
}

describe("runModelProviderWizard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readConfigFileSnapshot.mockResolvedValue({
      exists: true,
      valid: true,
      config: {},
      sourceConfig: {},
      hash: "config-hash",
    });
    mocks.runProviderPluginAuthMethod.mockResolvedValue({
      config: {},
      profileCount: 1,
      patched: false,
      defaultModel: "openai/gpt-5.4",
    });
  });

  it("loads provider setup runtime only after selecting a manifest-backed provider", async () => {
    mocks.resolveManifestProviderAuthChoices.mockReturnValue([
      createChoice({
        providerId: "openai",
        methodId: "api-key",
        choiceId: "openai-api-key",
        choiceLabel: "OpenAI API key",
        groupLabel: "OpenAI",
      }),
      createChoice({
        providerId: "vllm",
        methodId: "local",
        choiceId: "vllm",
        choiceLabel: "vLLM",
        groupLabel: "vLLM",
      }),
    ]);
    const openaiProvider = createProvider({
      providerId: "openai",
      providerLabel: "OpenAI",
      methodId: "api-key",
      choiceId: "openai-api-key",
    });
    mocks.resolvePluginProviders.mockImplementation((params?: { providerRefs?: string[] }) =>
      params?.providerRefs?.includes("openai") ? [openaiProvider] : [],
    );
    const select: WizardPrompter["select"] = async <T>(
      params: WizardSelectParams<T>,
    ): Promise<T> => {
      expect(params.message).toBe("Select a model provider");
      expect(mocks.resolvePluginProviders).not.toHaveBeenCalled();
      return "openai" as T;
    };
    const prompter = createPrompter(select);

    await runModelProviderWizard({ prompter, skipIntro: true, setDefault: true });

    expect(mocks.resolvePluginProviders).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "setup",
        providerRefs: ["openai"],
        activate: true,
        includeUntrustedWorkspacePlugins: false,
      }),
    );
    expect(mocks.runProviderPluginAuthMethod).toHaveBeenCalledWith(
      expect.objectContaining({
        method: openaiProvider.auth[0],
        secretInputMode: "plaintext",
      }),
    );
    expect(mocks.replaceConfigFile).toHaveBeenCalledWith({
      baseHash: "config-hash",
      nextConfig: {
        agents: {
          defaults: {
            model: {
              primary: "openai/gpt-5.4",
            },
            models: {
              "openai/gpt-5.4": {},
            },
          },
        },
      } satisfies GenesisConfig,
    });
    expect(mocks.invalidateModelAuthStatusCache).toHaveBeenCalledOnce();
  });

  it("uses manifest metadata for requested providers without loading every setup runtime", async () => {
    mocks.resolveManifestProviderAuthChoices.mockReturnValue([
      createChoice({
        providerId: "openai",
        methodId: "api-key",
        choiceId: "openai-api-key",
        choiceLabel: "OpenAI API key",
        groupLabel: "OpenAI",
      }),
      createChoice({
        providerId: "vllm",
        methodId: "local",
        choiceId: "vllm",
        choiceLabel: "vLLM",
        groupLabel: "vLLM",
      }),
    ]);
    const openaiProvider = createProvider({
      providerId: "openai",
      providerLabel: "OpenAI",
      methodId: "api-key",
      choiceId: "openai-api-key",
    });
    mocks.resolvePluginProviders.mockReturnValue([openaiProvider]);
    let selectCalls = 0;
    const select: WizardPrompter["select"] = async <T>(): Promise<T> => {
      selectCalls += 1;
      return "vllm" as T;
    };
    const prompter = createPrompter(select);

    await runModelProviderWizard({
      prompter,
      skipIntro: true,
      provider: "openai",
      authMethod: "api-key",
      setDefault: true,
    });

    expect(selectCalls).toBe(0);
    expect(mocks.resolvePluginProviders).toHaveBeenCalledOnce();
    expect(mocks.resolvePluginProviders).toHaveBeenCalledWith(
      expect.objectContaining({
        providerRefs: ["openai"],
        activate: true,
      }),
    );
  });
});
