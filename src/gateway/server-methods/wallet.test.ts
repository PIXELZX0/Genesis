import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ loadConfig: vi.fn() }));

vi.mock("../../config/config.js", () => ({ loadConfig: mocks.loadConfig }));

const { walletHandlers } = await import("./wallet.js");

async function invokeNodeWalletWeb3(params: Record<string, unknown>) {
  let response: unknown[] | undefined;
  await walletHandlers["node.wallet.web3"]({
    params,
    respond: (...args: unknown[]) => {
      response = args;
    },
  } as never);
  return response;
}

describe("node.wallet.web3", () => {
  it("returns the gateway browser provider config to node hosts", async () => {
    mocks.loadConfig.mockReturnValue({
      wallet: { browser: { enabled: true, allowedOrigins: ["https://dapp.example/path"] } },
    });
    await expect(invokeNodeWalletWeb3({ op: "config" })).resolves.toEqual([
      true,
      { enabled: true, allowedOrigins: ["https://dapp.example"] },
      undefined,
    ]);
  });

  it("wraps provider errors in an EIP-1193 envelope", async () => {
    mocks.loadConfig.mockReturnValue({ wallet: { browser: { enabled: false } } });
    const response = await invokeNodeWalletWeb3({
      op: "request",
      chain: "evm",
      origin: "https://dapp.example",
      method: "eth_accounts",
    });
    expect(response?.[0]).toBe(true);
    expect(response?.[1]).toMatchObject({ ok: false, code: 4100 });
  });

  it("rejects incomplete request params", async () => {
    const response = await invokeNodeWalletWeb3({ op: "request", chain: "evm" });
    expect(response?.[0]).toBe(false);
  });
});
