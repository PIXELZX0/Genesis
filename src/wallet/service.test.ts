import { describe, expect, it } from "vitest";
import { sendWallet } from "./service.js";

describe("wallet send guard", () => {
  it("requires all explicit send gates before unlocking or broadcasting", async () => {
    const base = {
      chain: "evm" as const,
      to: "0x0000000000000000000000000000000000000001",
      amount: "1",
      passphrase: "unused",
    };

    await expect(
      sendWallet({
        ...base,
        config: { spending: { enabled: false } },
        guard: { yes: true, allowEnv: { GENESIS_WALLET_ALLOW_SPEND: "1" } },
      }),
    ).rejects.toThrow(/spending is disabled/);

    await expect(
      sendWallet({
        ...base,
        config: { spending: { enabled: true } },
        guard: { yes: false, allowEnv: { GENESIS_WALLET_ALLOW_SPEND: "1" } },
      }),
    ).rejects.toThrow(/--yes/);

    await expect(
      sendWallet({
        ...base,
        config: { spending: { enabled: true } },
        guard: { yes: true, allowEnv: {} },
      }),
    ).rejects.toThrow(/GENESIS_WALLET_ALLOW_SPEND=1/);
  });

  it("enforces per-chain native amount limits", async () => {
    await expect(
      sendWallet({
        chain: "sol",
        to: "11111111111111111111111111111111",
        amount: "1.000000001",
        passphrase: "unused",
        config: { spending: { enabled: true, maxNativeAmount: "1" } },
        guard: { yes: true, allowEnv: { GENESIS_WALLET_ALLOW_SPEND: "1" } },
      }),
    ).rejects.toThrow(/maxNativeAmount/);
  });
});
