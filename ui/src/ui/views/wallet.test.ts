/* @vitest-environment jsdom */

import { render } from "lit";
import { describe, expect, it } from "vitest";
import type { WalletSummaryResult } from "../types.ts";
import { renderWallet, type WalletProps } from "./wallet.ts";

function createSummary(): WalletSummaryResult {
  return {
    enabled: true,
    keystore: { exists: true, locked: true },
    primaryAccount: "evm:default",
    accounts: [
      {
        id: "evm:default",
        chain: "evm",
        address: "0x9858EfFD232B4033E47d90003D41EC34EcaEda94",
        network: "ethereum",
        derivationPath: "m/44'/60'/0'/0/0",
        createdAt: "2026-04-27T00:00:00.000Z",
        updatedAt: "2026-04-27T00:00:00.000Z",
      },
    ],
    balances: [
      {
        chain: "evm",
        accountId: "evm:default",
        address: "0x9858EfFD232B4033E47d90003D41EC34EcaEda94",
        network: "ethereum",
        asset: "ETH",
        amountAtomic: "1250000000000000000",
        amount: "1.25",
      },
    ],
    warnings: [],
  };
}

function createProps(overrides: Partial<WalletProps> = {}): WalletProps {
  return {
    connected: true,
    loading: false,
    balancesLoading: false,
    summary: createSummary(),
    error: null,
    lastUpdatedAt: Date.parse("2026-04-27T00:00:00.000Z"),
    onRefresh: () => undefined,
    onConfigure: () => undefined,
    ...overrides,
  };
}

describe("wallet view", () => {
  it("renders public accounts and balances without secret-bearing controls", async () => {
    const container = document.createElement("div");

    render(renderWallet(createProps()), container);
    await Promise.resolve();

    expect(container.textContent).toContain("Wallet config");
    expect(container.textContent).toContain("evm:default");
    expect(container.textContent).toContain("0x9858EfFD232B4033E47d90003D41EC34EcaEda94");
    expect(container.textContent).toContain("1.25 ETH");
    expect(container.textContent).toContain("Primary");
    expect(container.textContent).not.toMatch(/mnemonic|private|passphrase|seed|send/i);
    expect(container.querySelector("button[aria-label='Copy address']")).not.toBeNull();
  });

  it("shows the missing-keystore empty state", async () => {
    const container = document.createElement("div");

    render(
      renderWallet(
        createProps({
          summary: {
            enabled: true,
            keystore: { exists: false, locked: true },
            accounts: [],
            warnings: [],
          },
        }),
      ),
      container,
    );
    await Promise.resolve();

    expect(container.textContent).toContain("No wallet keystore found.");
    expect(container.textContent).toContain("Missing");
  });
});
