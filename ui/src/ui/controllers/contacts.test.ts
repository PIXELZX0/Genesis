import { describe, expect, it, vi } from "vitest";
import type { GatewayBrowserClient } from "../gateway.ts";
import { CONTACTS_REQUEST_TIMEOUT_MS, loadContacts, type ContactEntry } from "./contacts.ts";

type RequestFn = (method: string, params?: unknown, opts?: unknown) => Promise<unknown>;

function clientWith(request: RequestFn): GatewayBrowserClient {
  return { request } as unknown as GatewayBrowserClient;
}

const contact: ContactEntry = {
  id: "contact-1",
  name: "Ada",
  messengerIds: [{ channel: "telegram", id: "ada" }],
  createdAt: 1,
  updatedAt: 2,
};

describe("loadContacts", () => {
  it("returns contacts from the RPC with a bounded timeout", async () => {
    const request = vi.fn(async () => ({ contacts: [contact] }));

    await expect(loadContacts(clientWith(request), "main")).resolves.toEqual([contact]);
    expect(request).toHaveBeenCalledWith(
      "contacts.list",
      { agentId: "main" },
      { timeoutMs: CONTACTS_REQUEST_TIMEOUT_MS },
    );
  });

  it("treats an empty successful response as an empty list", async () => {
    const request = vi.fn(async () => ({ contacts: [] }));

    await expect(loadContacts(clientWith(request), "main")).resolves.toEqual([]);
  });

  it("propagates contact RPC errors", async () => {
    const request = vi.fn(async () => {
      throw new Error("gateway unavailable");
    });

    await expect(loadContacts(clientWith(request), "main")).rejects.toThrow("gateway unavailable");
  });
});
