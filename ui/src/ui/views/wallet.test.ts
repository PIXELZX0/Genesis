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
    recoveryPhraseMode: "generate",
    recoveryPhraseBusy: false,
    recoveryPhraseError: null,
    recoveryPhraseGeneratedMnemonic: null,
    recoveryPhraseStatus: null,
    onRefresh: () => undefined,
    onConfigure: () => undefined,
    onRecoveryPhraseModeChange: () => undefined,
    onManageRecoveryPhrase: () => true,
    ...overrides,
  };
}

describe("wallet view", () => {
  it("renders public accounts, balances, and recovery phrase controls", async () => {
    const container = document.createElement("div");

    render(renderWallet(createProps()), container);
    await Promise.resolve();

    expect(container.textContent).toContain("Wallet config");
    expect(container.textContent).toContain("evm:default");
    expect(container.textContent).toContain("0x9858EfFD232B4033E47d90003D41EC34EcaEda94");
    expect(container.textContent).toContain("1.25 ETH");
    expect(container.textContent).toContain("Primary");
    expect(container.textContent).toContain("Secret Recovery Phrase");
    expect(container.textContent).toContain("Generate wallet");
    expect(container.textContent).not.toMatch(/private key|send/i);
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

  it("submits recovery phrase imports and resets secret fields on success", async () => {
    const container = document.createElement("div");
    const submissions: unknown[] = [];

    render(
      renderWallet(
        createProps({
          recoveryPhraseMode: "import",
          onManageRecoveryPhrase: async (input) => {
            submissions.push(input);
            return true;
          },
        }),
      ),
      container,
    );
    await Promise.resolve();

    const mnemonic = container.querySelector<HTMLTextAreaElement>("textarea[name='mnemonic']");
    const passphrase = container.querySelector<HTMLInputElement>("input[name='passphrase']");
    const confirmPassphrase = container.querySelector<HTMLInputElement>(
      "input[name='confirmPassphrase']",
    );
    const overwrite = container.querySelector<HTMLInputElement>("input[name='overwrite']");
    const form = container.querySelector<HTMLFormElement>("form");
    expect(mnemonic).not.toBeNull();
    expect(passphrase).not.toBeNull();
    expect(confirmPassphrase).not.toBeNull();
    expect(overwrite).not.toBeNull();
    expect(form).not.toBeNull();
    if (!mnemonic || !passphrase || !confirmPassphrase || !overwrite || !form) {
      return;
    }

    mnemonic.value =
      "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
    passphrase.value = "correct horse battery staple";
    confirmPassphrase.value = "correct horse battery staple";
    overwrite.checked = true;
    form.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));
    await Promise.resolve();
    await Promise.resolve();

    expect(submissions).toEqual([
      {
        mode: "import",
        mnemonic:
          "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
        passphrase: "correct horse battery staple",
        confirmPassphrase: "correct horse battery staple",
        overwrite: true,
      },
    ]);
    expect(mnemonic.value).toBe("");
    expect(passphrase.value).toBe("");
    expect(confirmPassphrase.value).toBe("");
    expect(overwrite.checked).toBe(false);
  });
});
