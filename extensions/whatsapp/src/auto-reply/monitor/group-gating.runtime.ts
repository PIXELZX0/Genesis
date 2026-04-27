export {
  implicitMentionKindWhen,
  resolveInboundMentionDecision,
} from "genesis/plugin-sdk/channel-mention-gating";
export { hasControlCommand } from "genesis/plugin-sdk/command-detection";
export { recordPendingHistoryEntryIfEnabled } from "genesis/plugin-sdk/reply-history";
export { parseActivationCommand } from "genesis/plugin-sdk/group-activation";
export { normalizeE164 } from "../../text-runtime.js";
