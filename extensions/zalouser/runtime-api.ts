// Private runtime barrel for the bundled Zalo Personal extension.
// Keep this barrel thin and aligned with the local extension surface.

export * from "./api.js";
export { setZalouserRuntime } from "./src/runtime.js";
export type { ReplyPayload } from "genesis/plugin-sdk/reply-runtime";
export type {
  BaseProbeResult,
  ChannelAccountSnapshot,
  ChannelDirectoryEntry,
  ChannelGroupContext,
  ChannelMessageActionAdapter,
  ChannelStatusIssue,
} from "genesis/plugin-sdk/channel-contract";
export type {
  GenesisConfig,
  GroupToolPolicyConfig,
  MarkdownTableMode,
} from "genesis/plugin-sdk/config-runtime";
export type {
  PluginRuntime,
  AnyAgentTool,
  ChannelPlugin,
  GenesisPluginToolContext,
} from "genesis/plugin-sdk/core";
export type { RuntimeEnv } from "genesis/plugin-sdk/runtime";
export {
  DEFAULT_ACCOUNT_ID,
  buildChannelConfigSchema,
  normalizeAccountId,
} from "genesis/plugin-sdk/core";
export { chunkTextForOutbound } from "genesis/plugin-sdk/text-chunking";
export {
  isDangerousNameMatchingEnabled,
  resolveDefaultGroupPolicy,
  resolveOpenProviderRuntimeGroupPolicy,
  warnMissingProviderGroupPolicyFallbackOnce,
} from "genesis/plugin-sdk/config-runtime";
export {
  mergeAllowlist,
  summarizeMapping,
  formatAllowFromLowercase,
} from "genesis/plugin-sdk/allow-from";
export { resolveInboundMentionDecision } from "genesis/plugin-sdk/channel-inbound";
export { createChannelPairingController } from "genesis/plugin-sdk/channel-pairing";
export { createChannelReplyPipeline } from "genesis/plugin-sdk/channel-reply-pipeline";
export { buildBaseAccountStatusSnapshot } from "genesis/plugin-sdk/status-helpers";
export { resolveSenderCommandAuthorization } from "genesis/plugin-sdk/command-auth";
export {
  evaluateGroupRouteAccessForPolicy,
  resolveSenderScopedGroupPolicy,
} from "genesis/plugin-sdk/group-access";
export { loadOutboundMediaFromUrl } from "genesis/plugin-sdk/outbound-media";
export {
  deliverTextOrMediaReply,
  isNumericTargetId,
  resolveSendableOutboundReplyParts,
  sendPayloadWithChunkedTextAndMedia,
  type OutboundReplyPayload,
} from "genesis/plugin-sdk/reply-payload";
export { resolvePreferredGenesisTmpDir } from "genesis/plugin-sdk/browser-security-runtime";
