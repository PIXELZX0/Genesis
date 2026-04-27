// Private runtime barrel for the bundled Feishu extension.
// Keep this barrel thin and generic-only.

export type {
  AllowlistMatch,
  AnyAgentTool,
  BaseProbeResult,
  ChannelGroupContext,
  ChannelMessageActionName,
  ChannelMeta,
  ChannelOutboundAdapter,
  ChannelPlugin,
  HistoryEntry,
  GenesisConfig,
  GenesisPluginApi,
  OutboundIdentity,
  PluginRuntime,
  ReplyPayload,
} from "genesis/plugin-sdk/core";
export type { GenesisConfig as ClawdbotConfig } from "genesis/plugin-sdk/core";
export type { RuntimeEnv } from "genesis/plugin-sdk/runtime";
export type { GroupToolPolicyConfig } from "genesis/plugin-sdk/config-runtime";
export {
  DEFAULT_ACCOUNT_ID,
  buildChannelConfigSchema,
  createActionGate,
  createDedupeCache,
} from "genesis/plugin-sdk/core";
export {
  PAIRING_APPROVED_MESSAGE,
  buildProbeChannelStatusSummary,
  createDefaultChannelRuntimeState,
} from "genesis/plugin-sdk/channel-status";
export { buildAgentMediaPayload } from "genesis/plugin-sdk/agent-media-payload";
export { createChannelPairingController } from "genesis/plugin-sdk/channel-pairing";
export { createReplyPrefixContext } from "genesis/plugin-sdk/channel-reply-pipeline";
export {
  evaluateSupplementalContextVisibility,
  filterSupplementalContextItems,
  resolveChannelContextVisibilityMode,
} from "genesis/plugin-sdk/config-runtime";
export { loadSessionStore, resolveSessionStoreEntry } from "genesis/plugin-sdk/config-runtime";
export { readJsonFileWithFallback } from "genesis/plugin-sdk/json-store";
export { createPersistentDedupe } from "genesis/plugin-sdk/persistent-dedupe";
export { normalizeAgentId } from "genesis/plugin-sdk/routing";
export { chunkTextForOutbound } from "genesis/plugin-sdk/text-chunking";
export {
  isRequestBodyLimitError,
  readRequestBodyWithLimit,
  requestBodyErrorToText,
} from "genesis/plugin-sdk/webhook-ingress";
export { setFeishuRuntime } from "./src/runtime.js";
