/** A single messenger identity belonging to a contact (e.g. telegram:12345). */
export type ContactMessengerId = {
  /** Channel/provider id, e.g. "telegram", "discord", "whatsapp". */
  channel: string;
  /** Channel-specific sender id (Telegram numeric id, Discord snowflake, WhatsApp JID, ...). */
  id: string;
  /** Optional handle/username for display. */
  username?: string;
};

/** A remembered person and the messenger identities that map to them. */
export type Contact = {
  /** Canonical, slug-safe id. Used as the unified DM session anchor. */
  id: string;
  name: string;
  age?: number;
  education?: string;
  traits?: string[];
  notes?: string;
  messengerIds: ContactMessengerId[];
  createdAt: number;
  updatedAt: number;
};

export type ContactStore = {
  version: number;
  contacts: Record<string, Contact>;
};

export const CONTACT_STORE_VERSION = 1;

export const CONTACT_STORE_FILENAME = "contacts.json";
