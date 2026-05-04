import {
  resolveAgentDir,
  resolveAgentWorkspaceDir,
  resolveDefaultAgentId,
} from "../../agents/agent-scope.js";
import { resolveDefaultAgentWorkspaceDir } from "../../agents/workspace.js";
import { readConfigFileSnapshot, replaceConfigFile } from "../../config/config.js";
import { formatConfigIssueLines } from "../../config/issue-format.js";
import type { GenesisConfig } from "../../config/types.genesis.js";
import {
  applyDefaultModel,
  pickAuthMethod,
  resolveProviderMatch,
} from "../../plugins/provider-auth-choice-helpers.js";
import { runProviderPluginAuthMethod } from "../../plugins/provider-auth-choice.js";
import { runProviderModelSelectedHook } from "../../plugins/provider-auth-choice.runtime.js";
import { resolvePluginProviders } from "../../plugins/providers.runtime.js";
import type { ProviderAuthMethod, ProviderPlugin } from "../../plugins/types.js";
import { defaultRuntime } from "../../runtime.js";
import { readStringValue } from "../../shared/string-coerce.js";
import type { WizardPrompter } from "../../wizard/prompts.js";
import { invalidateModelAuthStatusCache } from "./models-auth-status.js";

function listProvidersWithAuthMethods(providers: ProviderPlugin[]): ProviderPlugin[] {
  return providers.filter((provider) => provider.auth.length > 0);
}

function sortProviderOptions(providers: ProviderPlugin[]): ProviderPlugin[] {
  return [...providers].toSorted((a, b) => {
    const label = a.label.localeCompare(b.label);
    return label === 0 ? a.id.localeCompare(b.id) : label;
  });
}

function sortAuthMethods(methods: ProviderAuthMethod[]): ProviderAuthMethod[] {
  return [...methods].toSorted((a, b) => {
    const label = a.label.localeCompare(b.label);
    return label === 0 ? a.id.localeCompare(b.id) : label;
  });
}

function formatInvalidConfigMessage(snapshot: Awaited<ReturnType<typeof readConfigFileSnapshot>>) {
  const issues = formatConfigIssueLines(snapshot.issues ?? [], "-").join("\n");
  return `Invalid config; fix it before running model provider setup.${issues ? `\n${issues}` : ""}`;
}

async function selectProvider(params: {
  providers: ProviderPlugin[];
  requestedProvider?: string;
  prompter: WizardPrompter;
}): Promise<ProviderPlugin> {
  const requested = params.requestedProvider?.trim();
  if (requested) {
    const matched = resolveProviderMatch(params.providers, requested);
    if (!matched) {
      const available = params.providers
        .map((provider) => provider.id)
        .toSorted()
        .join(", ");
      throw new Error(`Unknown provider "${requested}". Available providers: ${available}`);
    }
    return matched;
  }

  const options = sortProviderOptions(params.providers).map((provider) => ({
    value: provider.id,
    label: provider.label,
    hint: provider.docsPath ? `Docs: ${provider.docsPath}` : provider.auth[0]?.hint,
  }));
  const selected = await params.prompter.select({
    message: "Select a model provider",
    options,
    searchable: true,
  });
  const matched = resolveProviderMatch(params.providers, selected);
  if (!matched) {
    throw new Error("Unknown provider selected.");
  }
  return matched;
}

async function selectAuthMethod(params: {
  provider: ProviderPlugin;
  requestedMethod?: string;
  prompter: WizardPrompter;
}): Promise<ProviderAuthMethod> {
  const requested = params.requestedMethod?.trim();
  if (requested) {
    const matched = pickAuthMethod(params.provider, requested);
    if (!matched) {
      const available = params.provider.auth
        .map((method) => method.id)
        .toSorted()
        .join(", ");
      throw new Error(
        `Unknown auth method "${requested}" for provider "${params.provider.id}". Available methods: ${available}`,
      );
    }
    return matched;
  }

  if (params.provider.auth.length === 1 && params.provider.auth[0]) {
    return params.provider.auth[0];
  }

  const methods = sortAuthMethods(params.provider.auth);
  const selected = await params.prompter.select({
    message: `Auth method for ${params.provider.label}`,
    options: methods.map((method) => ({
      value: method.id,
      label: method.label,
      hint: method.hint,
    })),
  });
  const matched = pickAuthMethod(params.provider, selected);
  if (!matched) {
    throw new Error("Unknown auth method selected.");
  }
  return matched;
}

async function promptClientOpenUrl(prompter: WizardPrompter, url: string): Promise<void> {
  await prompter.note(["Open this URL in your browser:", url].join("\n"), "Browser sign-in");
}

export async function runModelProviderWizard(params: {
  provider?: unknown;
  authMethod?: unknown;
  setDefault?: unknown;
  prompter: WizardPrompter;
}): Promise<void> {
  const snapshot = await readConfigFileSnapshot();
  if (snapshot.exists && !snapshot.valid) {
    throw new Error(formatInvalidConfigMessage(snapshot));
  }

  const config = structuredClone(snapshot.sourceConfig ?? snapshot.config ?? {}) as GenesisConfig;
  const agentId = resolveDefaultAgentId(config);
  const agentDir = resolveAgentDir(config, agentId);
  const workspaceDir =
    resolveAgentWorkspaceDir(config, agentId) ?? resolveDefaultAgentWorkspaceDir();
  const requestedProvider = readStringValue(params.provider);
  const requestedMethod = readStringValue(params.authMethod);
  const providers = listProvidersWithAuthMethods(
    resolvePluginProviders({
      config,
      workspaceDir,
      mode: "setup",
      bundledProviderAllowlistCompat: true,
      bundledProviderVitestCompat: true,
      ...(requestedProvider ? { providerRefs: [requestedProvider], activate: true } : {}),
    }),
  );

  if (providers.length === 0) {
    throw new Error("No model provider auth plugins are available.");
  }

  await params.prompter.intro("Model provider setup");
  const provider = await selectProvider({
    providers,
    requestedProvider,
    prompter: params.prompter,
  });
  const method = await selectAuthMethod({
    provider,
    requestedMethod,
    prompter: params.prompter,
  });

  const applied = await runProviderPluginAuthMethod({
    config,
    env: process.env,
    runtime: defaultRuntime,
    prompter: params.prompter,
    method,
    agentDir,
    agentId,
    workspaceDir,
    emitNotes: true,
    allowSecretRefPrompt: false,
    secretInputMode: "plaintext",
    isRemote: false,
    openUrl: async (url) => {
      await promptClientOpenUrl(params.prompter, url);
    },
    opts: {},
  });

  let nextConfig = applied.config;
  if (applied.profileCount === 0 && !applied.patched && !applied.defaultModel) {
    await params.prompter.note("No provider credentials were stored.", "Provider setup skipped");
  } else if (applied.defaultModel) {
    const requestedSetDefault =
      typeof params.setDefault === "boolean" ? params.setDefault : undefined;
    const shouldSetDefault =
      requestedSetDefault ??
      (await params.prompter.confirm({
        message: `Set ${applied.defaultModel} as the default model?`,
        initialValue: true,
      }));
    if (shouldSetDefault) {
      nextConfig = applyDefaultModel(nextConfig, applied.defaultModel);
      await runProviderModelSelectedHook({
        config: nextConfig,
        model: applied.defaultModel,
        prompter: params.prompter,
        agentDir,
        workspaceDir,
        env: process.env,
      });
      await params.prompter.note(
        `Default model set to ${applied.defaultModel}`,
        "Model configured",
      );
    } else {
      await params.prompter.note(
        `${applied.defaultModel} is available in the model picker.`,
        "Provider connected",
      );
    }
  } else {
    await params.prompter.note(`${provider.label} is connected.`, "Provider connected");
  }

  await replaceConfigFile({
    nextConfig,
    ...(snapshot.hash !== undefined ? { baseHash: snapshot.hash } : {}),
  });
  invalidateModelAuthStatusCache();
  await params.prompter.outro("Model provider setup complete.");
}
