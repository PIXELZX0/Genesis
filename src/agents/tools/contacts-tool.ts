import { Type } from "typebox";
import type { GenesisConfig } from "../../config/types.genesis.js";
import {
  addMessengerId,
  deleteContact,
  findContactByMessengerId,
  loadContactStore,
  updateContactStoreWithLock,
  upsertContact,
} from "../../contacts/store.js";
import type { ContactMessengerId } from "../../contacts/types.js";
import { stringEnum } from "../schema/string-enum.js";
import {
  type AnyAgentTool,
  jsonResult,
  readNumberParam,
  readStringArrayParam,
  readStringParam,
  ToolInputError,
} from "./common.js";

const CONTACT_ACTIONS = ["save", "list", "get", "delete", "link"] as const;

const MessengerSchema = Type.Object({
  channel: Type.String({ description: "Channel id, e.g. telegram, discord, whatsapp." }),
  id: Type.String({ description: "Channel-specific sender id for this person." }),
  username: Type.Optional(Type.String({ description: "Optional handle/username." })),
});

const ContactsSchema = Type.Object({
  action: stringEnum(CONTACT_ACTIONS, {
    description:
      "save: create/update a person. list: all contacts. get: one contact. delete: remove. link: add a messenger id to an existing contact.",
  }),
  id: Type.Optional(
    Type.String({
      description: "Canonical contact id (for get/delete/link, or to target an upsert).",
    }),
  ),
  name: Type.Optional(Type.String({ description: "Person's name." })),
  age: Type.Optional(Type.Number({ description: "Person's age." })),
  education: Type.Optional(Type.String({ description: "Education background." })),
  traits: Type.Optional(
    Type.Array(Type.String(), { description: "Short trait/characteristic tags." }),
  ),
  notes: Type.Optional(Type.String({ description: "Free-form notes about the person." })),
  messengers: Type.Optional(
    Type.Array(MessengerSchema, {
      description: "Messenger identities to associate (save). Same person across messengers.",
    }),
  ),
  channel: Type.Optional(Type.String({ description: "Channel id for the link action." })),
  messenger_id: Type.Optional(Type.String({ description: "Sender id for the link action." })),
  username: Type.Optional(Type.String({ description: "Optional handle for the link action." })),
});

function parseMessengers(raw: unknown): ContactMessengerId[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: ContactMessengerId[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const channel = typeof record.channel === "string" ? record.channel.trim() : "";
    const id =
      typeof record.id === "string"
        ? record.id.trim()
        : typeof record.id === "number"
          ? String(record.id)
          : "";
    if (!channel || !id) {
      continue;
    }
    const username = typeof record.username === "string" ? record.username.trim() : undefined;
    out.push({ channel, id, ...(username ? { username } : {}) });
  }
  return out;
}

export function createContactsTool(options?: {
  agentDir?: string;
  config?: GenesisConfig;
}): AnyAgentTool | null {
  const agentDir = options?.agentDir?.trim();
  if (!agentDir) {
    return null;
  }
  if (options?.config?.session?.contacts?.enabled !== true) {
    return null;
  }
  return {
    label: "Contacts",
    name: "contacts",
    description:
      "Remember people across messengers: save name/age/education/traits/notes and their per-messenger IDs. Linking a person's messenger IDs lets them share one DM session across messengers.",
    parameters: ContactsSchema,
    ownerOnly: true,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action", { required: true });

      if (action === "list") {
        const store = loadContactStore(agentDir);
        return jsonResult({
          contacts: Object.values(store.contacts).map((c) => ({
            id: c.id,
            name: c.name,
            messengerIds: c.messengerIds,
          })),
        });
      }

      if (action === "get") {
        const store = loadContactStore(agentDir);
        const id = readStringParam(params, "id");
        const channel = readStringParam(params, "channel");
        const messengerId = readStringParam(params, "messenger_id");
        const contact = id
          ? store.contacts[id]
          : channel && messengerId
            ? findContactByMessengerId(store, channel, messengerId)
            : undefined;
        if (!contact) {
          throw new ToolInputError("contact not found");
        }
        return jsonResult({ contact });
      }

      if (action === "save") {
        const store = await updateContactStoreWithLock({
          agentDir,
          updater: (s) => {
            upsertContact(s, {
              id: readStringParam(params, "id"),
              name: readStringParam(params, "name"),
              age: readNumberParam(params, "age", { integer: true }),
              education: readStringParam(params, "education"),
              traits: readStringArrayParam(params, "traits"),
              notes: readStringParam(params, "notes"),
              messengerIds: parseMessengers(params.messengers),
            });
            return true;
          },
        });
        if (!store) {
          throw new ToolInputError("failed to save contact");
        }
        // Return the freshly upserted contact (re-resolve from the saved store).
        const id = readStringParam(params, "id");
        const messengers = parseMessengers(params.messengers);
        const saved = id
          ? store.contacts[id]
          : messengers.map((m) => findContactByMessengerId(store, m.channel, m.id)).find(Boolean);
        return jsonResult({ saved: true, contact: saved });
      }

      if (action === "link") {
        const id = readStringParam(params, "id", { required: true });
        const channel = readStringParam(params, "channel", { required: true });
        const messengerId = readStringParam(params, "messenger_id", { required: true });
        const username = readStringParam(params, "username");
        let added = false;
        const store = await updateContactStoreWithLock({
          agentDir,
          updater: (s) => {
            added = addMessengerId(s, id, {
              channel,
              id: messengerId,
              ...(username ? { username } : {}),
            });
            return added;
          },
        });
        if (!store || !store.contacts[id]) {
          throw new ToolInputError("contact not found");
        }
        return jsonResult({ linked: added, contact: store.contacts[id] });
      }

      if (action === "delete") {
        const id = readStringParam(params, "id", { required: true });
        let removed = false;
        await updateContactStoreWithLock({
          agentDir,
          updater: (s) => {
            removed = deleteContact(s, id);
            return removed;
          },
        });
        return jsonResult({ deleted: removed, id });
      }

      throw new ToolInputError(`unknown action: ${action}`);
    },
  };
}
