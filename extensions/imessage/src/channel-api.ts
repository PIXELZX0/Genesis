import { formatTrimmedAllowFromEntries } from "genesis/plugin-sdk/channel-config-helpers";
import type { ChannelStatusIssue } from "genesis/plugin-sdk/channel-contract";
import { PAIRING_APPROVED_MESSAGE } from "genesis/plugin-sdk/channel-status";
import {
  DEFAULT_ACCOUNT_ID,
  getChatChannelMeta,
  type ChannelPlugin,
  type GenesisConfig,
} from "genesis/plugin-sdk/core";
import { resolveChannelMediaMaxBytes } from "genesis/plugin-sdk/media-runtime";
import { collectStatusIssuesFromLastError } from "genesis/plugin-sdk/status-helpers";
import {
  resolveIMessageConfigAllowFrom,
  resolveIMessageConfigDefaultTo,
} from "./config-accessors.js";
import { looksLikeIMessageTargetId, normalizeIMessageMessagingTarget } from "./normalize.js";
export { chunkTextForOutbound } from "genesis/plugin-sdk/text-chunking";

export {
  collectStatusIssuesFromLastError,
  DEFAULT_ACCOUNT_ID,
  formatTrimmedAllowFromEntries,
  getChatChannelMeta,
  looksLikeIMessageTargetId,
  normalizeIMessageMessagingTarget,
  PAIRING_APPROVED_MESSAGE,
  resolveChannelMediaMaxBytes,
  resolveIMessageConfigAllowFrom,
  resolveIMessageConfigDefaultTo,
};

export type { ChannelPlugin, ChannelStatusIssue, GenesisConfig };
