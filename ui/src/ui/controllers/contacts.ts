import type { GatewayBrowserClient } from "../gateway.ts";

export const CONTACTS_REQUEST_TIMEOUT_MS = 15_000;

export interface ContactMessengerId {
  channel: string;
  id: string;
  username?: string;
}

export interface ContactEntry {
  id: string;
  name: string;
  age?: number;
  education?: string;
  traits?: string[];
  notes?: string;
  messengerIds: ContactMessengerId[];
  createdAt: number;
  updatedAt: number;
}

/** Load the contact list for an agent via the `contacts.list` RPC. */
export async function loadContacts(
  client: GatewayBrowserClient,
  agentId: string,
): Promise<ContactEntry[]> {
  const res = await client.request<{ contacts?: ContactEntry[] } | null>(
    "contacts.list",
    { agentId },
    { timeoutMs: CONTACTS_REQUEST_TIMEOUT_MS },
  );
  return res?.contacts ?? [];
}
