export { getChatChannelMeta, type ChannelPlugin } from "genesis/plugin-sdk/core";
export { buildChannelConfigSchema, WhatsAppConfigSchema } from "../config-api.js";
export { DEFAULT_ACCOUNT_ID } from "genesis/plugin-sdk/account-id";
export {
  formatWhatsAppConfigAllowFromEntries,
  resolveWhatsAppConfigAllowFrom,
  resolveWhatsAppConfigDefaultTo,
} from "./config-accessors.js";
export {
  createActionGate,
  jsonResult,
  readReactionParams,
  readStringParam,
  ToolAuthorizationError,
} from "genesis/plugin-sdk/channel-actions";
export { normalizeE164 } from "genesis/plugin-sdk/account-resolution";
export type { DmPolicy, GroupPolicy } from "genesis/plugin-sdk/config-runtime";
import type { GenesisConfig as RuntimeGenesisConfig } from "genesis/plugin-sdk/config-runtime";

export { type ChannelMessageActionName } from "genesis/plugin-sdk/channel-contract";
export { loadOutboundMediaFromUrl } from "./outbound-media.runtime.js";
export {
  resolveWhatsAppGroupRequireMention,
  resolveWhatsAppGroupToolPolicy,
} from "./group-policy.js";
export {
  resolveWhatsAppGroupIntroHint,
  resolveWhatsAppMentionStripRegexes,
} from "./group-intro.js";
export { resolveWhatsAppHeartbeatRecipients } from "./heartbeat-recipients.js";
export { createWhatsAppOutboundBase } from "./outbound-base.js";
export {
  isWhatsAppGroupJid,
  isWhatsAppUserTarget,
  looksLikeWhatsAppTargetId,
  normalizeWhatsAppAllowFromEntries,
  normalizeWhatsAppMessagingTarget,
  normalizeWhatsAppTarget,
} from "./normalize-target.js";
export { resolveWhatsAppOutboundTarget } from "./resolve-outbound-target.js";
export { resolveWhatsAppReactionLevel } from "./reaction-level.js";

export type GenesisConfig = RuntimeGenesisConfig;
export type { WhatsAppAccountConfig } from "./account-types.js";

type MonitorWebChannel = typeof import("./channel.runtime.js").monitorWebChannel;

let channelRuntimePromise: Promise<typeof import("./channel.runtime.js")> | null = null;

function loadChannelRuntime() {
  channelRuntimePromise ??= import("./channel.runtime.js");
  return channelRuntimePromise;
}

export async function monitorWebChannel(
  ...args: Parameters<MonitorWebChannel>
): ReturnType<MonitorWebChannel> {
  const { monitorWebChannel } = await loadChannelRuntime();
  return await monitorWebChannel(...args);
}
