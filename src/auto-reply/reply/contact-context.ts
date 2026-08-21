import { normalizeChatType } from "../../channels/chat-type.js";
import type { GenesisConfig } from "../../config/types.genesis.js";
import { isContactsEnabled, resolveContactLegacyAgentDirs } from "../../contacts/config.js";
import {
  findContactByMessengerId,
  loadContactStore,
  updateContactStoreWithLock,
  upsertContact,
} from "../../contacts/store.js";
import { normalizeOptionalString } from "../../shared/string-coerce.js";
import { INTERNAL_MESSAGE_CHANNEL } from "../../utils/message-channel-constants.js";
import type { MsgContext } from "../templating.js";

function resolveContactChannel(ctx: MsgContext): string | undefined {
  return normalizeOptionalString(ctx.Provider ?? ctx.OriginatingChannel ?? ctx.Surface);
}

/**
 * When contacts are enabled, resolve the contact owning this direct sender and
 * stash a curated profile onto the context (consumed by inbound-meta). For
 * unknown direct senders, auto-capture a stub contact so it can be enriched
 * later via the contacts tool.
 *
 * Mutates `sessionCtx` in place; no-op for non-direct chats or when disabled.
 */
export async function applyContactContext(params: {
  cfg: GenesisConfig | undefined;
  agentDir?: string;
  stateDir?: string;
  sessionCtx: MsgContext;
}): Promise<void> {
  const { cfg, agentDir, stateDir, sessionCtx } = params;
  if (!isContactsEnabled(cfg)) {
    return;
  }
  const legacyAgentDirs = resolveContactLegacyAgentDirs(cfg, { stateDir, agentDir });
  const chatType = normalizeChatType(sessionCtx.ChatType);
  if (chatType && chatType !== "direct") {
    return;
  }
  const channel = resolveContactChannel(sessionCtx);
  const senderId = normalizeOptionalString(sessionCtx.SenderId);
  if (!channel || channel.toLowerCase() === INTERNAL_MESSAGE_CHANNEL || !senderId) {
    return;
  }

  let contact = findContactByMessengerId(
    loadContactStore(stateDir, { legacyAgentDirs }),
    channel,
    senderId,
  );

  if (!contact) {
    // Auto-capture an unknown direct sender as a stub for later enrichment.
    const senderName = normalizeOptionalString(sessionCtx.SenderName);
    const username = normalizeOptionalString(sessionCtx.SenderUsername);
    const store = await updateContactStoreWithLock({
      stateDir,
      legacyAgentDirs,
      updater: (s) => {
        // Re-check inside the lock to avoid duplicate stubs under concurrency.
        if (findContactByMessengerId(s, channel, senderId)) {
          return false;
        }
        upsertContact(s, {
          name: senderName ?? username ?? senderId,
          messengerIds: [{ channel, id: senderId, ...(username ? { username } : {}) }],
        });
        return true;
      },
    });
    if (store) {
      contact = findContactByMessengerId(store, channel, senderId);
    }
  }

  if (!contact) {
    return;
  }

  sessionCtx.ContactId = contact.id;
  sessionCtx.ContactName = contact.name;
  sessionCtx.ContactProfile = {
    ...(contact.age !== undefined ? { age: contact.age } : {}),
    ...(contact.education !== undefined ? { education: contact.education } : {}),
    ...(contact.traits !== undefined ? { traits: contact.traits } : {}),
    ...(contact.notes !== undefined ? { notes: contact.notes } : {}),
  };
}
