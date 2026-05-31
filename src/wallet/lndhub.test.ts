import { afterEach, describe, expect, it, vi } from "vitest";
import { getLndHubBalance, resetLndHubAuthCache, sendLndHubTransaction } from "./lndhub.js";

const config = {
  networks: {
    lndhub: {
      baseUrl: "https://lndhub.example.com",
      login: "user",
      password: "pass",
    },
  },
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("lndhub wallet adapter", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    resetLndHubAuthCache();
  });

  it("reads balance via auth and /balance without exposing secrets", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ access_token: "token123" }))
      .mockResolvedValueOnce(jsonResponse({ address: "bc1test" }))
      .mockResolvedValueOnce(jsonResponse({ BTC: { AvailableBalance: 123456 } }));
    vi.stubGlobal("fetch", fetchMock);

    const balance = await getLndHubBalance(config);

    expect(balance).toMatchObject({
      chain: "lndhub",
      accountId: "lndhub:rpc",
      address: "bc1test",
      asset: "BTC",
      amount: "0.00123456",
      amountAtomic: "123456",
      confirmedAmountAtomic: "123456",
      pendingAmountAtomic: "0",
    });
    expect(JSON.stringify(balance)).not.toContain("pass");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://lndhub.example.com/auth",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ login: "user", password: "pass" }),
      }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "https://lndhub.example.com/balance",
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: "Bearer token123",
        }),
      }),
    );
  });

  it("pays a BOLT11 invoice and returns payment_hash as txId", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ access_token: "token123" }))
      .mockResolvedValueOnce(jsonResponse({ address: "bc1test" }))
      .mockResolvedValueOnce(
        jsonResponse({ payment_preimage: "preimage", payment_hash: "hash123" }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const sent = await sendLndHubTransaction({
      to: "lnbc1invoice",
      amount: "0.0001",
      config,
    });

    expect(sent.txId).toBe("hash123");
    expect(sent.amountAtomic).toBe("10000");
    expect(sent.chain).toBe("lndhub");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://lndhub.example.com/payinvoice",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer token123",
          "content-type": "application/json",
        }),
        body: JSON.stringify({ invoice: "lnbc1invoice" }),
      }),
    );
  });

  it("rejects non-invoice destinations", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ access_token: "token123" }))
      .mockResolvedValueOnce(jsonResponse({ address: "bc1test" }))
      .mockResolvedValueOnce(jsonResponse({ BTC: { AvailableBalance: 1000000 } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      sendLndHubTransaction({ to: "bc1address", amount: "0.001", config }),
    ).rejects.toThrow(/BOLT11 invoice/);
  });

  it("uses lightningAddress from config when available", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ access_token: "token123" }))
      .mockResolvedValueOnce(jsonResponse({ BTC: { AvailableBalance: 50000 } }));
    vi.stubGlobal("fetch", fetchMock);

    const customConfig = {
      networks: {
        lndhub: {
          baseUrl: "https://lndhub.example.com",
          lightningAddress: "user@walletofsatoshi.com",
        },
      },
    };

    const balance = await getLndHubBalance(customConfig);
    expect(balance.address).toBe("user@walletofsatoshi.com");
    expect(fetchMock).not.toHaveBeenCalledWith(
      "https://lndhub.example.com/getbtc",
      expect.anything(),
    );
  });
});
