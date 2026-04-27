import type { GenesisConfig } from "genesis/plugin-sdk/config-runtime";
import {
  resolveConfiguredBindingRoute,
  resolveRuntimeConversationBindingRoute,
} from "genesis/plugin-sdk/conversation-runtime";
import { resolveAgentRoute } from "genesis/plugin-sdk/routing";
import { logVerbose } from "genesis/plugin-sdk/runtime-env";
import { resolveIMessageInboundConversationId } from "./conversation-id.js";

export function resolveIMessageConversationRoute(params: {
  cfg: GenesisConfig;
  accountId: string;
  isGroup: boolean;
  peerId: string;
  sender: string;
  chatId?: number;
}): ReturnType<typeof resolveAgentRoute> {
  let route = resolveAgentRoute({
    cfg: params.cfg,
    channel: "imessage",
    accountId: params.accountId,
    peer: {
      kind: params.isGroup ? "group" : "direct",
      id: params.peerId,
    },
  });

  const conversationId = resolveIMessageInboundConversationId({
    isGroup: params.isGroup,
    sender: params.sender,
    chatId: params.chatId,
  });
  if (!conversationId) {
    return route;
  }

  route = resolveConfiguredBindingRoute({
    cfg: params.cfg,
    route,
    conversation: {
      channel: "imessage",
      accountId: params.accountId,
      conversationId,
    },
  }).route;

  const runtimeRoute = resolveRuntimeConversationBindingRoute({
    route,
    conversation: {
      channel: "imessage",
      accountId: params.accountId,
      conversationId,
    },
  });
  route = runtimeRoute.route;
  if (runtimeRoute.bindingRecord && !runtimeRoute.boundSessionKey) {
    logVerbose(`imessage: plugin-bound conversation ${conversationId}`);
  } else if (runtimeRoute.boundSessionKey) {
    logVerbose(
      `imessage: routed via bound conversation ${conversationId} -> ${runtimeRoute.boundSessionKey}`,
    );
  }
  return route;
}
