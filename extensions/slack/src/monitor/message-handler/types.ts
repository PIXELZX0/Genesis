import type { FinalizedMsgContext } from "genesis/plugin-sdk/reply-runtime";
import type { ResolvedAgentRoute } from "genesis/plugin-sdk/routing";
import type { ResolvedSlackAccount } from "../../accounts.js";
import type { SlackMessageEvent } from "../../types.js";
import type { SlackChannelConfigResolved } from "../channel-config.js";
import type { SlackMonitorContext } from "../context.js";

export type PreparedSlackMessage = {
  ctx: SlackMonitorContext;
  account: ResolvedSlackAccount;
  message: SlackMessageEvent;
  route: ResolvedAgentRoute;
  channelConfig: SlackChannelConfigResolved | null;
  replyTarget: string;
  ctxPayload: FinalizedMsgContext;
  replyToMode: "off" | "first" | "all" | "batched";
  isDirectMessage: boolean;
  isRoomish: boolean;
  historyKey: string;
  preview: string;
  ackReactionMessageTs?: string;
  ackReactionValue: string;
  ackReactionPromise: Promise<boolean> | null;
};
