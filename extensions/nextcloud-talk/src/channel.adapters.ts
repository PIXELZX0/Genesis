import { formatAllowFromLowercase } from "genesis/plugin-sdk/allow-from";
import {
  adaptScopedAccountAccessor,
  createScopedChannelConfigAdapter,
  createScopedDmSecurityResolver,
} from "genesis/plugin-sdk/channel-config-helpers";
import { createPairingPrefixStripper } from "genesis/plugin-sdk/channel-pairing";
import { normalizeLowercaseStringOrEmpty } from "genesis/plugin-sdk/text-runtime";
import {
  listNextcloudTalkAccountIds,
  resolveDefaultNextcloudTalkAccountId,
  resolveNextcloudTalkAccount,
  type ResolvedNextcloudTalkAccount,
} from "./accounts.js";
import type { CoreConfig } from "./types.js";

export const nextcloudTalkConfigAdapter = createScopedChannelConfigAdapter<
  ResolvedNextcloudTalkAccount,
  ResolvedNextcloudTalkAccount,
  CoreConfig
>({
  sectionKey: "nextcloud-talk",
  listAccountIds: listNextcloudTalkAccountIds,
  resolveAccount: adaptScopedAccountAccessor(resolveNextcloudTalkAccount),
  defaultAccountId: resolveDefaultNextcloudTalkAccountId,
  clearBaseFields: ["botSecret", "botSecretFile", "baseUrl", "name"],
  resolveAllowFrom: (account) => account.config.allowFrom,
  formatAllowFrom: (allowFrom) =>
    formatAllowFromLowercase({
      allowFrom,
      stripPrefixRe: /^(nextcloud-talk|nc-talk|nc):/i,
    }),
});

export const nextcloudTalkSecurityAdapter = {
  resolveDmPolicy: createScopedDmSecurityResolver<ResolvedNextcloudTalkAccount>({
    channelKey: "nextcloud-talk",
    resolvePolicy: (account) => account.config.dmPolicy,
    resolveAllowFrom: (account) => account.config.allowFrom,
    policyPathSuffix: "dmPolicy",
    normalizeEntry: (raw) =>
      normalizeLowercaseStringOrEmpty(raw.trim().replace(/^(nextcloud-talk|nc-talk|nc):/i, "")),
  }),
};

export const nextcloudTalkPairingTextAdapter = {
  idLabel: "nextcloudUserId",
  message: "Genesis: your access has been approved.",
  normalizeAllowEntry: createPairingPrefixStripper(/^(nextcloud-talk|nc-talk|nc):/i, (entry) =>
    normalizeLowercaseStringOrEmpty(entry),
  ),
};
