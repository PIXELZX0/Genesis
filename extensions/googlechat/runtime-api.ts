// Private runtime barrel for the bundled Google Chat extension.
// Keep this barrel thin and avoid broad plugin-sdk surfaces during bootstrap.

export { DEFAULT_ACCOUNT_ID } from "genesis/plugin-sdk/account-id";
export {
  createActionGate,
  jsonResult,
  readNumberParam,
  readReactionParams,
  readStringParam,
} from "genesis/plugin-sdk/channel-actions";
export { buildChannelConfigSchema } from "genesis/plugin-sdk/channel-config-primitives";
export type {
  ChannelMessageActionAdapter,
  ChannelMessageActionName,
  ChannelStatusIssue,
} from "genesis/plugin-sdk/channel-contract";
export { missingTargetError } from "genesis/plugin-sdk/channel-feedback";
export {
  createAccountStatusSink,
  runPassiveAccountLifecycle,
} from "genesis/plugin-sdk/channel-lifecycle";
export { createChannelPairingController } from "genesis/plugin-sdk/channel-pairing";
export { createChannelReplyPipeline } from "genesis/plugin-sdk/channel-reply-pipeline";
export {
  evaluateGroupRouteAccessForPolicy,
  resolveDmGroupAccessWithLists,
  resolveSenderScopedGroupPolicy,
} from "genesis/plugin-sdk/channel-policy";
export { PAIRING_APPROVED_MESSAGE } from "genesis/plugin-sdk/channel-status";
export { chunkTextForOutbound } from "genesis/plugin-sdk/text-chunking";
export type { GenesisConfig } from "genesis/plugin-sdk/config-runtime";
export {
  GROUP_POLICY_BLOCKED_LABEL,
  isDangerousNameMatchingEnabled,
  resolveAllowlistProviderRuntimeGroupPolicy,
  resolveDefaultGroupPolicy,
  warnMissingProviderGroupPolicyFallbackOnce,
} from "genesis/plugin-sdk/config-runtime";
export { fetchRemoteMedia, resolveChannelMediaMaxBytes } from "genesis/plugin-sdk/media-runtime";
export { loadOutboundMediaFromUrl } from "genesis/plugin-sdk/outbound-media";
export type { PluginRuntime } from "genesis/plugin-sdk/runtime-store";
export { fetchWithSsrFGuard } from "genesis/plugin-sdk/ssrf-runtime";
export {
  GoogleChatConfigSchema,
  type GoogleChatAccountConfig,
  type GoogleChatConfig,
} from "genesis/plugin-sdk/googlechat-runtime-shared";
export { extractToolSend } from "genesis/plugin-sdk/tool-send";
export { resolveInboundMentionDecision } from "genesis/plugin-sdk/channel-inbound";
export { resolveInboundRouteEnvelopeBuilderWithRuntime } from "genesis/plugin-sdk/inbound-envelope";
export { resolveWebhookPath } from "genesis/plugin-sdk/webhook-path";
export {
  registerWebhookTargetWithPluginRoute,
  resolveWebhookTargetWithAuthOrReject,
  withResolvedWebhookRequestPipeline,
} from "genesis/plugin-sdk/webhook-targets";
export {
  createWebhookInFlightLimiter,
  readJsonWebhookBodyOrReject,
  type WebhookInFlightLimiter,
} from "genesis/plugin-sdk/webhook-request-guards";
export { setGoogleChatRuntime } from "./src/runtime.js";
