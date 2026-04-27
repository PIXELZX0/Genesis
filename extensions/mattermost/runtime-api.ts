// Private runtime barrel for the bundled Mattermost extension.
// Keep this barrel thin and generic-only.

export type {
  BaseProbeResult,
  ChannelAccountSnapshot,
  ChannelDirectoryEntry,
  ChannelGroupContext,
  ChannelMessageActionName,
  ChannelPlugin,
  ChatType,
  HistoryEntry,
  GenesisConfig,
  GenesisPluginApi,
  PluginRuntime,
} from "genesis/plugin-sdk/core";
export type { RuntimeEnv } from "genesis/plugin-sdk/runtime";
export type { ReplyPayload } from "genesis/plugin-sdk/reply-runtime";
export type { ModelsProviderData } from "genesis/plugin-sdk/command-auth";
export type {
  BlockStreamingCoalesceConfig,
  DmPolicy,
  GroupPolicy,
} from "genesis/plugin-sdk/config-runtime";
export {
  DEFAULT_ACCOUNT_ID,
  buildChannelConfigSchema,
  createDedupeCache,
  parseStrictPositiveInteger,
  resolveClientIp,
  isTrustedProxyAddress,
} from "genesis/plugin-sdk/core";
export { buildComputedAccountStatusSnapshot } from "genesis/plugin-sdk/channel-status";
export { createAccountStatusSink } from "genesis/plugin-sdk/channel-lifecycle";
export { buildAgentMediaPayload } from "genesis/plugin-sdk/agent-media-payload";
export {
  buildModelsProviderData,
  listSkillCommandsForAgents,
  resolveControlCommandGate,
  resolveStoredModelOverride,
} from "genesis/plugin-sdk/command-auth";
export {
  GROUP_POLICY_BLOCKED_LABEL,
  isDangerousNameMatchingEnabled,
  loadSessionStore,
  resolveAllowlistProviderRuntimeGroupPolicy,
  resolveDefaultGroupPolicy,
  resolveStorePath,
  warnMissingProviderGroupPolicyFallbackOnce,
} from "genesis/plugin-sdk/config-runtime";
export { formatInboundFromLabel } from "genesis/plugin-sdk/channel-inbound";
export { logInboundDrop } from "genesis/plugin-sdk/channel-inbound";
export { createChannelPairingController } from "genesis/plugin-sdk/channel-pairing";
export {
  DM_GROUP_ACCESS_REASON,
  readStoreAllowFromForDmPolicy,
  resolveDmGroupAccessWithLists,
  resolveEffectiveAllowFromLists,
} from "genesis/plugin-sdk/channel-policy";
export { evaluateSenderGroupAccessForPolicy } from "genesis/plugin-sdk/group-access";
export { createChannelReplyPipeline } from "genesis/plugin-sdk/channel-reply-pipeline";
export { logTypingFailure } from "genesis/plugin-sdk/channel-feedback";
export { loadOutboundMediaFromUrl } from "genesis/plugin-sdk/outbound-media";
export { rawDataToString } from "genesis/plugin-sdk/browser-node-runtime";
export { chunkTextForOutbound } from "genesis/plugin-sdk/text-chunking";
export {
  DEFAULT_GROUP_HISTORY_LIMIT,
  buildPendingHistoryContextFromMap,
  clearHistoryEntriesIfEnabled,
  recordPendingHistoryEntryIfEnabled,
} from "genesis/plugin-sdk/reply-history";
export { normalizeAccountId, resolveThreadSessionKeys } from "genesis/plugin-sdk/routing";
export { resolveAllowlistMatchSimple } from "genesis/plugin-sdk/allow-from";
export { registerPluginHttpRoute } from "genesis/plugin-sdk/webhook-targets";
export {
  isRequestBodyLimitError,
  readRequestBodyWithLimit,
} from "genesis/plugin-sdk/webhook-ingress";
export {
  applyAccountNameToChannelSection,
  applySetupAccountConfigPatch,
  migrateBaseNameToDefaultAccount,
} from "genesis/plugin-sdk/setup";
export {
  getAgentScopedMediaLocalRoots,
  resolveChannelMediaMaxBytes,
} from "genesis/plugin-sdk/media-runtime";
export { normalizeProviderId } from "genesis/plugin-sdk/provider-model-shared";
export { setMattermostRuntime } from "./src/runtime.js";
