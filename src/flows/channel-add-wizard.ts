import { resolveDefaultAgentId } from "../agents/agent-scope.js";
import { getLoadedChannelPlugin } from "../channels/plugins/index.js";
import type { ChannelSetupPlugin } from "../channels/plugins/setup-wizard-types.js";
import { applyAgentBindings, describeBinding } from "../commands/agents.bindings.js";
import { buildAgentSummaries } from "../commands/agents.config.js";
import type { ChannelChoice } from "../commands/onboard-types.js";
import { replaceConfigFile, type GenesisConfig } from "../config/config.js";
import { DEFAULT_ACCOUNT_ID, normalizeAccountId } from "../routing/session-key.js";
import type { RuntimeEnv } from "../runtime.js";
import type { WizardPrompter } from "../wizard/prompts.js";
import {
  createChannelOnboardingPostWriteHookCollector,
  runCollectedChannelOnboardingPostWriteHooks,
  setupChannels,
} from "./channel-setup.js";

type ChannelSetupLike = Pick<ChannelSetupPlugin, "config" | "setup">;

export type InteractiveChannelsAddWizardParams = {
  cfg: GenesisConfig;
  baseHash?: string;
  runtime: RuntimeEnv;
  prompter: WizardPrompter;
  initialSelection?: ChannelChoice[];
  skipIntro?: boolean;
};

export type InteractiveChannelsAddWizardResult = {
  nextConfig: GenesisConfig;
  selection: ChannelChoice[];
  wrote: boolean;
};

function applyAccountName(params: {
  cfg: GenesisConfig;
  channel: ChannelChoice;
  accountId: string;
  name?: string;
  plugin?: ChannelSetupLike;
}): GenesisConfig {
  const accountId = normalizeAccountId(params.accountId);
  const apply = params.plugin?.setup?.applyAccountName;
  return apply ? apply({ cfg: params.cfg, accountId, name: params.name }) : params.cfg;
}

function resolveSetupPlugin(
  channel: ChannelChoice,
  plugins: Map<ChannelChoice, ChannelSetupPlugin>,
): ChannelSetupLike | undefined {
  return plugins.get(channel) ?? getLoadedChannelPlugin(channel);
}

export async function runInteractiveChannelsAddWizard({
  cfg,
  baseHash,
  runtime,
  prompter,
  initialSelection,
  skipIntro,
}: InteractiveChannelsAddWizardParams): Promise<InteractiveChannelsAddWizardResult> {
  const postWriteHooks = createChannelOnboardingPostWriteHookCollector();
  let selection: ChannelChoice[] = [];
  const accountIds: Partial<Record<ChannelChoice, string>> = {};
  const resolvedPlugins = new Map<ChannelChoice, ChannelSetupPlugin>();

  if (!skipIntro) {
    await prompter.intro("Channel setup");
  }
  let nextConfig = await setupChannels(cfg, runtime, prompter, {
    allowDisable: false,
    allowSignalInstall: true,
    initialSelection,
    onPostWriteHook: (hook) => {
      postWriteHooks.collect(hook);
    },
    promptAccountIds: true,
    onSelection: (value) => {
      selection = value;
    },
    onAccountId: (channel, accountId) => {
      accountIds[channel] = accountId;
    },
    onResolvedPlugin: (channel, plugin) => {
      resolvedPlugins.set(channel, plugin);
    },
  });

  if (selection.length === 0) {
    await prompter.outro("No channels selected.");
    return { nextConfig, selection, wrote: false };
  }

  const wantsNames = await prompter.confirm({
    message: "Add display names for these accounts? (optional)",
    initialValue: false,
  });
  if (wantsNames) {
    for (const channel of selection) {
      const accountId = accountIds[channel] ?? DEFAULT_ACCOUNT_ID;
      const plugin = resolveSetupPlugin(channel, resolvedPlugins);
      const account = plugin?.config.resolveAccount(nextConfig, accountId) as
        | { name?: string }
        | undefined;
      const snapshot = plugin?.config.describeAccount?.(account, nextConfig);
      const existingName = snapshot?.name ?? account?.name;
      const name = await prompter.text({
        message: `${channel} account name (${accountId})`,
        initialValue: existingName,
      });
      if (name?.trim()) {
        nextConfig = applyAccountName({
          cfg: nextConfig,
          channel,
          accountId,
          name,
          plugin,
        });
      }
    }
  }

  const bindTargets = selection
    .map((channel) => ({
      channel,
      accountId: accountIds[channel]?.trim(),
    }))
    .filter(
      (
        value,
      ): value is {
        channel: ChannelChoice;
        accountId: string;
      } => Boolean(value.accountId),
    );
  if (bindTargets.length > 0) {
    const bindNow = await prompter.confirm({
      message: "Bind configured channel accounts to agents now?",
      initialValue: true,
    });
    if (bindNow) {
      const agentSummaries = buildAgentSummaries(nextConfig);
      const defaultAgentId = resolveDefaultAgentId(nextConfig);
      for (const target of bindTargets) {
        const targetAgentId = await prompter.select({
          message: `Route ${target.channel} account "${target.accountId}" to agent`,
          options: agentSummaries.map((agent) => ({
            value: agent.id,
            label: agent.isDefault ? `${agent.id} (default)` : agent.id,
          })),
          initialValue: defaultAgentId,
        });
        const bindingResult = applyAgentBindings(nextConfig, [
          {
            agentId: targetAgentId,
            match: { channel: target.channel, accountId: target.accountId },
          },
        ]);
        nextConfig = bindingResult.config;
        if (bindingResult.added.length > 0 || bindingResult.updated.length > 0) {
          await prompter.note(
            [
              ...bindingResult.added.map((binding) => `Added: ${describeBinding(binding)}`),
              ...bindingResult.updated.map((binding) => `Updated: ${describeBinding(binding)}`),
            ].join("\n"),
            "Routing bindings",
          );
        }
        if (bindingResult.conflicts.length > 0) {
          await prompter.note(
            [
              "Skipped bindings already claimed by another agent:",
              ...bindingResult.conflicts.map(
                (conflict) =>
                  `- ${describeBinding(conflict.binding)} (agent=${conflict.existingAgentId})`,
              ),
            ].join("\n"),
            "Routing bindings",
          );
        }
      }
    }
  }

  await replaceConfigFile({
    nextConfig,
    ...(baseHash !== undefined ? { baseHash } : {}),
  });
  await runCollectedChannelOnboardingPostWriteHooks({
    hooks: postWriteHooks.drain(),
    cfg: nextConfig,
    runtime,
  });
  await prompter.outro("Channels updated.");
  return { nextConfig, selection, wrote: true };
}
