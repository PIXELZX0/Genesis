// Private runtime barrel for the bundled IRC extension.
// Keep this barrel thin and generic-only.

export type { BaseProbeResult } from "genesis/plugin-sdk/channel-contract";
export type { ChannelPlugin } from "genesis/plugin-sdk/channel-core";
export type { GenesisConfig } from "genesis/plugin-sdk/config-runtime";
export type { PluginRuntime } from "genesis/plugin-sdk/runtime-store";
export type { RuntimeEnv } from "genesis/plugin-sdk/runtime";
export type {
  BlockStreamingCoalesceConfig,
  DmConfig,
  DmPolicy,
  GroupPolicy,
  GroupToolPolicyBySenderConfig,
  GroupToolPolicyConfig,
  MarkdownConfig,
} from "genesis/plugin-sdk/config-runtime";
export type { OutboundReplyPayload } from "genesis/plugin-sdk/reply-payload";
export { DEFAULT_ACCOUNT_ID } from "genesis/plugin-sdk/account-id";
export { buildChannelConfigSchema } from "genesis/plugin-sdk/channel-config-primitives";
export {
  PAIRING_APPROVED_MESSAGE,
  buildBaseChannelStatusSummary,
} from "genesis/plugin-sdk/channel-status";
export { createChannelPairingController } from "genesis/plugin-sdk/channel-pairing";
export { createAccountStatusSink } from "genesis/plugin-sdk/channel-lifecycle";
export {
  readStoreAllowFromForDmPolicy,
  resolveEffectiveAllowFromLists,
} from "genesis/plugin-sdk/channel-policy";
export { resolveControlCommandGate } from "genesis/plugin-sdk/command-auth";
export { dispatchInboundReplyWithBase } from "genesis/plugin-sdk/inbound-reply-dispatch";
export { chunkTextForOutbound } from "genesis/plugin-sdk/text-chunking";
export {
  deliverFormattedTextWithAttachments,
  formatTextWithAttachmentLinks,
  resolveOutboundMediaUrls,
} from "genesis/plugin-sdk/reply-payload";
export {
  GROUP_POLICY_BLOCKED_LABEL,
  isDangerousNameMatchingEnabled,
  resolveAllowlistProviderRuntimeGroupPolicy,
  resolveDefaultGroupPolicy,
  warnMissingProviderGroupPolicyFallbackOnce,
} from "genesis/plugin-sdk/config-runtime";
export { logInboundDrop } from "genesis/plugin-sdk/channel-inbound";
