import type { ReplyPayload } from "../../auto-reply/reply-payload.js";
import type { GenesisConfig } from "../../config/types.genesis.js";
import { getChannelPlugin, normalizeChannelId } from "./registry.js";

export function shouldSuppressLocalExecApprovalPrompt(params: {
  channel?: string | null;
  cfg: GenesisConfig;
  accountId?: string | null;
  payload: ReplyPayload;
}): boolean {
  const channel = params.channel ? normalizeChannelId(params.channel) : null;
  if (!channel) {
    return false;
  }
  return (
    getChannelPlugin(channel)?.outbound?.shouldSuppressLocalPayloadPrompt?.({
      cfg: params.cfg,
      accountId: params.accountId,
      payload: params.payload,
      hint: { kind: "approval-pending", approvalKind: "exec" },
    }) ?? false
  );
}
