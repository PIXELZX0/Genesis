import { describeAccountSnapshot } from "genesis/plugin-sdk/account-helpers";
import { formatNormalizedAllowFromEntries } from "genesis/plugin-sdk/allow-from";
import {
  adaptScopedAccountAccessor,
  createScopedChannelConfigAdapter,
} from "genesis/plugin-sdk/channel-config-helpers";
import type { ChannelPlugin } from "genesis/plugin-sdk/channel-core";
import { normalizeLowercaseStringOrEmpty } from "genesis/plugin-sdk/text-runtime";
import {
  listGoogleChatAccountIds,
  resolveDefaultGoogleChatAccountId,
  resolveGoogleChatAccount,
  type ResolvedGoogleChatAccount,
} from "./accounts.js";
import { googlechatSetupAdapter } from "./setup-core.js";
import { googlechatSetupWizard } from "./setup-surface.js";

const formatGoogleChatAllowFromEntry = (entry: string) =>
  normalizeLowercaseStringOrEmpty(
    entry
      .trim()
      .replace(/^(googlechat|google-chat|gchat):/i, "")
      .replace(/^user:/i, "")
      .replace(/^users\//i, ""),
  );

const googleChatConfigAdapter = createScopedChannelConfigAdapter<ResolvedGoogleChatAccount>({
  sectionKey: "googlechat",
  listAccountIds: listGoogleChatAccountIds,
  resolveAccount: adaptScopedAccountAccessor(resolveGoogleChatAccount),
  defaultAccountId: resolveDefaultGoogleChatAccountId,
  clearBaseFields: [
    "serviceAccount",
    "serviceAccountFile",
    "audienceType",
    "audience",
    "webhookPath",
    "webhookUrl",
    "botUser",
    "name",
  ],
  resolveAllowFrom: (account) => account.config.dm?.allowFrom,
  formatAllowFrom: (allowFrom) =>
    formatNormalizedAllowFromEntries({
      allowFrom,
      normalizeEntry: formatGoogleChatAllowFromEntry,
    }),
  resolveDefaultTo: (account) => account.config.defaultTo,
});

export const googlechatSetupPlugin: ChannelPlugin<ResolvedGoogleChatAccount> = {
  id: "googlechat",
  meta: {
    id: "googlechat",
    label: "Google Chat",
    selectionLabel: "Google Chat (Chat API)",
    docsPath: "/channels/googlechat",
    docsLabel: "googlechat",
    blurb: "Google Workspace Chat app with HTTP webhook.",
    aliases: ["gchat", "google-chat"],
    order: 55,
    detailLabel: "Google Chat",
    systemImage: "message.badge",
    markdownCapable: true,
  },
  setup: googlechatSetupAdapter,
  setupWizard: googlechatSetupWizard,
  capabilities: {
    chatTypes: ["direct", "group", "thread"],
    reactions: true,
    threads: true,
    media: true,
    nativeCommands: false,
    blockStreaming: true,
  },
  streaming: {
    blockStreamingCoalesceDefaults: { minChars: 1500, idleMs: 1000 },
  },
  reload: { configPrefixes: ["channels.googlechat"] },
  config: {
    ...googleChatConfigAdapter,
    isConfigured: (account) => account.credentialSource !== "none",
    describeAccount: (account) =>
      describeAccountSnapshot({
        account,
        configured: account.credentialSource !== "none",
        extra: {
          credentialSource: account.credentialSource,
        },
      }),
  },
};
