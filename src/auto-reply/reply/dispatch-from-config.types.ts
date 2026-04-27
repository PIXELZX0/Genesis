import type { GenesisConfig } from "../../config/types.genesis.js";
import type { GetReplyOptions } from "../get-reply-options.types.js";
import type { FinalizedMsgContext } from "../templating.js";
import type { FormatAbortReplyText, TryFastAbortFromMessage } from "./abort.runtime-types.js";
import type { GetReplyFromConfig } from "./get-reply.types.js";
import type { ReplyDispatchKind, ReplyDispatcher } from "./reply-dispatcher.types.js";

export type DispatchFromConfigResult = {
  queuedFinal: boolean;
  counts: Record<ReplyDispatchKind, number>;
};

export type DispatchFromConfigParams = {
  ctx: FinalizedMsgContext;
  cfg: GenesisConfig;
  dispatcher: ReplyDispatcher;
  replyOptions?: Omit<GetReplyOptions, "onBlockReply">;
  replyResolver?: GetReplyFromConfig;
  fastAbortResolver?: TryFastAbortFromMessage;
  formatAbortReplyTextResolver?: FormatAbortReplyText;
  /** Optional config override passed to getReplyFromConfig (e.g. per-sender timezone). */
  configOverride?: GenesisConfig;
};

export type DispatchReplyFromConfig = (
  params: DispatchFromConfigParams,
) => Promise<DispatchFromConfigResult>;
