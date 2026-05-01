import { afterEach, describe, expect, it, vi } from "vitest";
import { getXmrBalance, sendXmrTransaction } from "./xmr-rpc.js";

const config = {
  networks: {
    xmr: {
      walletRpcUrl: "http://127.0.0.1:18082/json_rpc",
      username: "rpc-user",
      password: "rpc-pass",
    },
  },
};

function jsonResponse(result: unknown): Response {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id: "genesis-wallet", result }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("monero wallet RPC adapter", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads address and balance without exposing wallet secrets", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ address: "48xmr-address" }))
      .mockResolvedValueOnce(
        jsonResponse({ balance: 1234000000000, unlocked_balance: 1200000000000 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const balance = await getXmrBalance(config);

    expect(balance).toMatchObject({
      chain: "xmr",
      accountId: "xmr:rpc",
      address: "48xmr-address",
      amount: "1.234",
      confirmedAmountAtomic: "1200000000000",
      pendingAmountAtomic: "34000000000",
    });
    expect(JSON.stringify(balance)).not.toContain("rpc-pass");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:18082/json_rpc",
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: "Basic cnBjLXVzZXI6cnBjLXBhc3M=",
        }),
      }),
    );
  });

  it("quotes through address lookup and sends transfer requests", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ address: "48xmr-address" }))
      .mockResolvedValueOnce(jsonResponse({ tx_hash: "xmr-tx" }));
    vi.stubGlobal("fetch", fetchMock);

    const sent = await sendXmrTransaction({
      to: "84destination",
      amount: "0.5",
      config,
    });

    expect(sent.txId).toBe("xmr-tx");
    expect(sent.amountAtomic).toBe("500000000000");
    const transferInit = fetchMock.mock.calls[1]?.[1] as RequestInit;
    if (typeof transferInit.body !== "string") {
      throw new Error("Expected XMR transfer request body to be a string.");
    }
    expect(JSON.parse(transferInit.body)).toMatchObject({
      method: "transfer",
      params: {
        destinations: [{ address: "84destination", amount: 500000000000 }],
      },
    });
  });

  it("rejects unsafe numeric atomic amounts returned by wallet RPC", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ address: "48xmr-address" }))
      .mockResolvedValueOnce(jsonResponse({ balance: Number.MAX_SAFE_INTEGER + 1 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getXmrBalance(config)).rejects.toThrow(/unsafe balance/);
  });
});
