// Narrow Matrix monitor helper seam.
// Keep monitor internals off the broad package runtime-api barrel so monitor
// tests and shared workers do not pull unrelated Matrix helper surfaces.

export type { NormalizedLocation } from "genesis/plugin-sdk/channel-location";
export type { PluginRuntime, RuntimeLogger } from "genesis/plugin-sdk/plugin-runtime";
export type { BlockReplyContext, ReplyPayload } from "genesis/plugin-sdk/reply-runtime";
export type { MarkdownTableMode, GenesisConfig } from "genesis/plugin-sdk/config-runtime";
export type { RuntimeEnv } from "genesis/plugin-sdk/runtime";
export {
  addAllowlistUserEntriesFromConfigEntry,
  buildAllowlistResolutionSummary,
  canonicalizeAllowlistWithResolvedIds,
  formatAllowlistMatchMeta,
  patchAllowlistUsersInConfigEntries,
  summarizeMapping,
} from "genesis/plugin-sdk/allow-from";
export {
  createReplyPrefixOptions,
  createTypingCallbacks,
} from "genesis/plugin-sdk/channel-reply-options-runtime";
export { formatLocationText, toLocationContext } from "genesis/plugin-sdk/channel-location";
export { getAgentScopedMediaLocalRoots } from "genesis/plugin-sdk/agent-media-payload";
export { logInboundDrop, logTypingFailure } from "genesis/plugin-sdk/channel-logging";
export { resolveAckReaction } from "genesis/plugin-sdk/channel-feedback";
export {
  buildChannelKeyCandidates,
  resolveChannelEntryMatch,
} from "genesis/plugin-sdk/channel-targets";
