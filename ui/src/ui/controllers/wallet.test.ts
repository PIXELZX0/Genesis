import { describe, expect, it, vi } from "vitest";
import type { WalletState } from "./wallet.ts";
import {
  addWalletToken,
  loadWalletSummary,
  lockWallet,
  setWalletRecoveryPhrase,
  unlockWallet,
} from "./wallet.ts";

function createState(): { request: ReturnType<typeof vi.fn>; state: WalletState } {
  const request = vi.fn();
  return {
    request,
    state: {
      client: { request } as unknown as WalletState["client"],
      connected: true,
      walletSummary: null,
      walletSummaryError: null,
      walletSummaryLoading: false,
      walletBalancesLoading: false,
      walletLastUpdatedAt: null,
      walletRecoveryPhraseMode: "generate",
      walletRecoveryPhraseBusy: false,
      walletRecoveryPhraseError: null,
      walletRecoveryPhraseGeneratedMnemonic: null,
      walletRecoveryPhraseStatus: null,
      walletUnlockBusy: false,
      walletUnlockError: null,
      walletTokenDialog: null,
    },
  };
}

describe("setWalletRecoveryPhrase", () => {
  it("requests native balances, tokens, and NFTs during a full wallet refresh", async () => {
    const { request, state } = createState();
    request.mockResolvedValue({
      enabled: true,
      keystore: { exists: true, locked: true },
      accounts: [],
      balances: [],
      tokens: [],
      nfts: [],
      warnings: [],
    });

    await loadWalletSummary(state, { includeBalances: true });

    expect(request).toHaveBeenCalledWith("wallet.summary", {
      includeBalances: true,
      includeTokens: true,
      includeNfts: true,
    });
    expect(state.walletSummary?.tokens).toEqual([]);
    expect(state.walletSummary?.nfts).toEqual([]);
  });

  it("validates generated passphrase confirmation before sending secret material", async () => {
    const { request, state } = createState();

    const ok = await setWalletRecoveryPhrase(state, {
      mode: "generate",
      mnemonic: "",
      passphrase: "one",
      confirmPassphrase: "two",
      overwrite: true,
    });

    expect(ok).toBe(false);
    expect(request).not.toHaveBeenCalled();
    expect(state.walletRecoveryPhraseError).toContain("confirmation");
  });

  it("imports phrases with one passphrase entry", async () => {
    const { request, state } = createState();
    request.mockResolvedValue({
      mnemonicGenerated: false,
      summary: {
        enabled: true,
        keystore: { exists: true, locked: true },
        accounts: [],
        warnings: [],
      },
    });

    const ok = await setWalletRecoveryPhrase(state, {
      mode: "import",
      mnemonic:
        "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
      passphrase: "correct horse battery staple",
      confirmPassphrase: "",
      overwrite: true,
    });

    expect(ok).toBe(true);
    expect(request).toHaveBeenCalledWith("wallet.recoveryPhrase.set", {
      mode: "import",
      mnemonic:
        "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
      passphrase: "correct horse battery staple",
      overwrite: true,
    });
  });

  it("normalizes imported phrases and updates summary state", async () => {
    const { request, state } = createState();
    request.mockResolvedValue({
      mnemonicGenerated: false,
      summary: {
        enabled: true,
        keystore: { exists: true, locked: true },
        accounts: [],
        warnings: [],
      },
    });

    const ok = await setWalletRecoveryPhrase(state, {
      mode: "import",
      mnemonic:
        " abandon   abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about ",
      passphrase: "correct horse battery staple",
      confirmPassphrase: "correct horse battery staple",
      overwrite: true,
    });

    expect(ok).toBe(true);
    expect(request).toHaveBeenCalledWith("wallet.recoveryPhrase.set", {
      mode: "import",
      mnemonic:
        "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
      passphrase: "correct horse battery staple",
      overwrite: true,
    });
    expect(state.walletSummary?.keystore.exists).toBe(true);
    expect(state.walletRecoveryPhraseStatus).toBe("imported");
    expect(state.walletRecoveryPhraseGeneratedMnemonic).toBeNull();
  });

  it("allows imported phrases without a passphrase", async () => {
    const { request, state } = createState();
    request.mockResolvedValue({
      mnemonicGenerated: false,
      summary: {
        enabled: true,
        keystore: { exists: true, locked: true },
        accounts: [],
        warnings: [],
      },
    });

    const ok = await setWalletRecoveryPhrase(state, {
      mode: "import",
      mnemonic:
        "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
      passphrase: "",
      confirmPassphrase: "",
      overwrite: true,
    });

    expect(ok).toBe(true);
    expect(request).toHaveBeenCalledWith("wallet.recoveryPhrase.set", {
      mode: "import",
      mnemonic:
        "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
      overwrite: true,
    });
  });

  it("allows generated phrases without a passphrase", async () => {
    const { request, state } = createState();
    request.mockResolvedValue({
      mnemonicGenerated: true,
      mnemonic: "fresh generated phrase",
      summary: {
        enabled: true,
        keystore: { exists: true, locked: true },
        accounts: [],
        warnings: [],
      },
    });

    const ok = await setWalletRecoveryPhrase(state, {
      mode: "generate",
      mnemonic: "",
      passphrase: "",
      confirmPassphrase: "",
      overwrite: false,
    });

    expect(ok).toBe(true);
    expect(request).toHaveBeenCalledWith("wallet.recoveryPhrase.set", {
      mode: "generate",
      overwrite: false,
    });
  });

  it("stores generated phrases only from the create response", async () => {
    const { request, state } = createState();
    request.mockResolvedValue({
      mnemonicGenerated: true,
      mnemonic: "fresh generated phrase",
      summary: {
        enabled: true,
        keystore: { exists: true, locked: true },
        accounts: [],
        warnings: [],
      },
    });

    const ok = await setWalletRecoveryPhrase(state, {
      mode: "generate",
      mnemonic: "",
      passphrase: "correct horse battery staple",
      confirmPassphrase: "correct horse battery staple",
      overwrite: false,
    });

    expect(ok).toBe(true);
    expect(request).toHaveBeenCalledWith("wallet.recoveryPhrase.set", {
      mode: "generate",
      passphrase: "correct horse battery staple",
      overwrite: false,
    });
    expect(state.walletRecoveryPhraseStatus).toBe("generated");
    expect(state.walletRecoveryPhraseGeneratedMnemonic).toBe("fresh generated phrase");
  });
});

describe("wallet unlock session", () => {
  it("unlocks with a millisecond TTL and refreshes the summary", async () => {
    const { request, state } = createState();
    const summary = {
      enabled: true,
      keystore: { exists: true, locked: false, unlockExpiresAt: 1 },
      accounts: [],
      warnings: [],
    };
    request.mockImplementation(async (method: string) =>
      method === "wallet.summary" ? summary : { unlocked: true, expiresAt: 1 },
    );

    await expect(unlockWallet(state, { passphrase: "pw", ttlMinutes: 60 })).resolves.toBe(true);
    expect(request).toHaveBeenNthCalledWith(1, "wallet.unlock", {
      passphrase: "pw",
      ttlMs: 3_600_000,
    });
    expect(state.walletSummary).toEqual(summary);
    expect(state.walletUnlockBusy).toBe(false);
  });

  it("surfaces unlock errors and locks through the gateway", async () => {
    const { request, state } = createState();
    request.mockRejectedValueOnce(new Error("bad passphrase"));
    await expect(unlockWallet(state, { passphrase: "x", ttlMinutes: 15 })).resolves.toBe(false);
    expect(state.walletUnlockError).toBe("bad passphrase");

    request.mockResolvedValue({ enabled: true, keystore: { exists: true, locked: true } });
    await lockWallet(state);
    expect(request).toHaveBeenCalledWith("wallet.lock", {});
    expect(state.walletUnlockError).toBeNull();
  });
});

describe("addWalletToken", () => {
  const dialog = { accountId: "evm:base", address: " 0xabc ", busy: false, error: null };

  it("adds the token, closes the dialog, and refreshes balances", async () => {
    const { request, state } = createState();
    state.walletTokenDialog = dialog;
    request.mockResolvedValue({ enabled: true, keystore: { exists: true }, accounts: [] });
    await addWalletToken(state);
    expect(request).toHaveBeenNthCalledWith(1, "wallet.token.add", {
      accountId: "evm:base",
      address: "0xabc",
    });
    expect(request).toHaveBeenNthCalledWith(2, "wallet.summary", {
      includeBalances: true,
      includeTokens: true,
      includeNfts: true,
    });
    expect(state.walletTokenDialog).toBeNull();
  });

  it("keeps the dialog open with the gateway error", async () => {
    const { request, state } = createState();
    state.walletTokenDialog = dialog;
    request.mockRejectedValueOnce(new Error("not an ERC-20 token"));
    await addWalletToken(state);
    expect(state.walletTokenDialog).toEqual({ ...dialog, error: "not an ERC-20 token" });
  });
});
