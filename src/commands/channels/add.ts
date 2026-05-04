import { resolveAgentWorkspaceDir, resolveDefaultAgentId } from "../../agents/agent-scope.js";
import { parseOptionalDelimitedEntries } from "../../channels/plugins/helpers.js";
import { getLoadedChannelPlugin, normalizeChannelId } from "../../channels/plugins/index.js";
import { moveSingleAccountChannelSectionToDefaultAccount } from "../../channels/plugins/setup-helpers.js";
import type { ChannelPlugin } from "../../channels/plugins/types.plugin.js";
import type { ChannelId, ChannelSetupInput } from "../../channels/plugins/types.public.js";
import { replaceConfigFile, type GenesisConfig } from "../../config/config.js";
import { runInteractiveChannelsAddWizard } from "../../flows/channel-add-wizard.js";
import { DEFAULT_ACCOUNT_ID, normalizeAccountId } from "../../routing/session-key.js";
import { defaultRuntime, type RuntimeEnv } from "../../runtime.js";
import { normalizeOptionalLowercaseString } from "../../shared/string-coerce.js";
import { createClackPrompter } from "../../wizard/clack-prompter.js";
import { applyChannelAccountConfig } from "./add-mutators.js";
import { channelLabel, requireValidConfigFileSnapshot, shouldUseWizard } from "./shared.js";

type ChannelSetupPluginInstallModule = typeof import("../channel-setup/plugin-install.js");
type OnboardChannelsModule = typeof import("../onboard-channels.js");

let channelSetupPluginInstallPromise: Promise<ChannelSetupPluginInstallModule> | undefined;
let onboardChannelsPromise: Promise<OnboardChannelsModule> | undefined;

function loadChannelSetupPluginInstall(): Promise<ChannelSetupPluginInstallModule> {
  channelSetupPluginInstallPromise ??= import("../channel-setup/plugin-install.js");
  return channelSetupPluginInstallPromise;
}

function loadOnboardChannels(): Promise<OnboardChannelsModule> {
  onboardChannelsPromise ??= import("../onboard-channels.js");
  return onboardChannelsPromise;
}

export type ChannelsAddOptions = {
  channel?: string;
  account?: string;
} & Record<string, unknown>;

const CHANNEL_ADD_CONTROL_OPTION_KEYS = new Set(["channel", "account"]);
const NEXTCLOUD_TALK_CLI_ALIASES = new Set(["nextcloud-talk", "nc-talk", "nc"]);

async function resolveCatalogChannelEntry(raw: string, cfg: GenesisConfig | null) {
  const trimmed = normalizeOptionalLowercaseString(raw);
  if (!trimmed) {
    return undefined;
  }
  const { listChannelPluginCatalogEntries } = await import("../../channels/plugins/catalog.js");
  const workspaceDir = cfg ? resolveAgentWorkspaceDir(cfg, resolveDefaultAgentId(cfg)) : undefined;
  return listChannelPluginCatalogEntries({ workspaceDir }).find((entry) => {
    if (normalizeOptionalLowercaseString(entry.id) === trimmed) {
      return true;
    }
    return (entry.meta.aliases ?? []).some(
      (alias) => normalizeOptionalLowercaseString(alias) === trimmed,
    );
  });
}

function parseOptionalInt(value: unknown): number | undefined {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    return Number.parseInt(value, 10);
  }
  return undefined;
}

function parseOptionalDelimitedInput(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === "string");
  }
  return parseOptionalDelimitedEntries(typeof value === "string" ? value : undefined);
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function buildChannelSetupInput(opts: ChannelsAddOptions): ChannelSetupInput {
  const input: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(opts)) {
    if (CHANNEL_ADD_CONTROL_OPTION_KEYS.has(key) || value === undefined) {
      continue;
    }
    input[key] = value;
  }

  const rawChannel = readOptionalString(opts.channel)?.trim().toLowerCase();
  if (rawChannel && NEXTCLOUD_TALK_CLI_ALIASES.has(rawChannel)) {
    input.baseUrl ??= readOptionalString(input.url);
    input.secret ??= readOptionalString(input.token) ?? readOptionalString(input.password);
    input.secretFile ??= readOptionalString(input.tokenFile);
  }

  input.initialSyncLimit = parseOptionalInt(opts.initialSyncLimit);
  input.groupChannels = parseOptionalDelimitedInput(opts.groupChannels);
  input.dmAllowlist = parseOptionalDelimitedInput(opts.dmAllowlist);
  return input as ChannelSetupInput;
}

export async function channelsAddCommand(
  opts: ChannelsAddOptions,
  runtime: RuntimeEnv = defaultRuntime,
  params?: { hasFlags?: boolean },
) {
  const configSnapshot = await requireValidConfigFileSnapshot(runtime);
  if (!configSnapshot) {
    return;
  }
  const cfg = (configSnapshot.sourceConfig ?? configSnapshot.config) as GenesisConfig;
  const baseHash = configSnapshot.hash;
  let nextConfig = cfg;

  const useWizard = shouldUseWizard(params);
  if (useWizard) {
    const prompter = createClackPrompter();
    await runInteractiveChannelsAddWizard({
      cfg,
      baseHash,
      runtime,
      prompter,
    });
    return;
  }

  const rawChannel = opts.channel ?? "";
  let channel = normalizeChannelId(rawChannel);
  let catalogEntry = channel ? undefined : await resolveCatalogChannelEntry(rawChannel, nextConfig);
  const resolveWorkspaceDir = () =>
    resolveAgentWorkspaceDir(nextConfig, resolveDefaultAgentId(nextConfig));
  // May trigger loadGenesisPlugins on cache miss (disk scan + jiti import)
  const loadScopedPlugin = async (
    channelId: ChannelId,
    pluginId?: string,
  ): Promise<ChannelPlugin | undefined> => {
    const existing = getLoadedChannelPlugin(channelId);
    if (existing) {
      return existing;
    }
    const { loadChannelSetupPluginRegistrySnapshotForChannel } =
      await loadChannelSetupPluginInstall();
    const snapshot = loadChannelSetupPluginRegistrySnapshotForChannel({
      cfg: nextConfig,
      runtime,
      channel: channelId,
      ...(pluginId ? { pluginId } : {}),
      workspaceDir: resolveWorkspaceDir(),
      installRuntimeDeps: false,
    });
    return (
      snapshot.channelSetups.find((entry) => entry.plugin.id === channelId)?.plugin ??
      snapshot.channels.find((entry) => entry.plugin.id === channelId)?.plugin
    );
  };

  if (!channel && catalogEntry) {
    const workspaceDir = resolveWorkspaceDir();
    const { isCatalogChannelInstalled } = await import("../channel-setup/discovery.js");
    if (
      !isCatalogChannelInstalled({
        cfg: nextConfig,
        entry: catalogEntry,
        workspaceDir,
      })
    ) {
      const { ensureChannelSetupPluginInstalled } = await loadChannelSetupPluginInstall();
      const prompter = createClackPrompter();
      const result = await ensureChannelSetupPluginInstalled({
        cfg: nextConfig,
        entry: catalogEntry,
        prompter,
        runtime,
        workspaceDir,
      });
      nextConfig = result.cfg;
      if (!result.installed) {
        return;
      }
      catalogEntry = {
        ...catalogEntry,
        ...(result.pluginId ? { pluginId: result.pluginId } : {}),
      };
    }
    channel = normalizeChannelId(catalogEntry.id) ?? (catalogEntry.id as ChannelId);
  }

  if (!channel) {
    const hint = catalogEntry
      ? `Plugin ${catalogEntry.meta.label} could not be loaded after install.`
      : `Unknown channel: ${rawChannel}`;
    runtime.error(hint);
    runtime.exit(1);
    return;
  }

  const plugin = await loadScopedPlugin(channel, catalogEntry?.pluginId);
  if (!plugin?.setup?.applyAccountConfig) {
    runtime.error(`Channel ${channel} does not support add.`);
    runtime.exit(1);
    return;
  }
  const input = buildChannelSetupInput(opts);
  const accountId =
    plugin.setup.resolveAccountId?.({
      cfg: nextConfig,
      accountId: opts.account,
      input,
    }) ?? normalizeAccountId(opts.account);

  const validationError = plugin.setup.validateInput?.({
    cfg: nextConfig,
    accountId,
    input,
  });
  if (validationError) {
    runtime.error(validationError);
    runtime.exit(1);
    return;
  }

  const prevConfig = nextConfig;

  if (accountId !== DEFAULT_ACCOUNT_ID) {
    nextConfig = moveSingleAccountChannelSectionToDefaultAccount({
      cfg: nextConfig,
      channelKey: channel,
    });
  }

  nextConfig = applyChannelAccountConfig({
    cfg: nextConfig,
    channel,
    accountId,
    input,
    plugin,
  });
  await plugin.lifecycle?.onAccountConfigChanged?.({
    prevCfg: prevConfig,
    nextCfg: nextConfig,
    accountId,
    runtime,
  });

  await replaceConfigFile({
    nextConfig,
    ...(baseHash !== undefined ? { baseHash } : {}),
  });
  runtime.log(`Added ${plugin.meta.label ?? channelLabel(channel)} account "${accountId}".`);
  const afterAccountConfigWritten = plugin.setup?.afterAccountConfigWritten;
  if (afterAccountConfigWritten) {
    const { runCollectedChannelOnboardingPostWriteHooks } = await loadOnboardChannels();
    await runCollectedChannelOnboardingPostWriteHooks({
      hooks: [
        {
          channel,
          accountId,
          run: async ({ cfg: writtenCfg, runtime: hookRuntime }) =>
            await afterAccountConfigWritten({
              previousCfg: cfg,
              cfg: writtenCfg,
              accountId,
              input,
              runtime: hookRuntime,
            }),
        },
      ],
      cfg: nextConfig,
      runtime,
    });
  }
}
