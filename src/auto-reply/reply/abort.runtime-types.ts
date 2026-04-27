import type { GenesisConfig } from "../../config/types.genesis.js";
import type { FinalizedMsgContext } from "../templating.js";

export type FastAbortResult = {
  handled: boolean;
  aborted: boolean;
  stoppedSubagents?: number;
};

export type TryFastAbortFromMessage = (params: {
  ctx: FinalizedMsgContext;
  cfg: GenesisConfig;
}) => Promise<FastAbortResult>;

export type FormatAbortReplyText = (stoppedSubagents?: number) => string;
