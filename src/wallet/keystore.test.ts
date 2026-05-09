import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { verifyMessage } from "ethers";
import { describe, expect, it } from "vitest";
import { resolveWalletKeystorePaths } from "./keystore.js";
import {
  initWallet,
  setWalletRecoveryPhrase,
  signWalletMessage,
  unlockWalletMnemonic,
} from "./service.js";

const MNEMONIC =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

async function tempEnv() {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "genesis-wallet-test-"));
  return { env: { ...process.env, GENESIS_STATE_DIR: stateDir }, stateDir };
}

describe("wallet keystore", () => {
  it("encrypts the mnemonic and preserves only public account metadata", async () => {
    const { env } = await tempEnv();
    const result = await initWallet({
      env,
      mnemonic: MNEMONIC,
      passphrase: "correct horse battery staple",
    });

    expect(result.summary.accounts.map((account) => account.id)).toEqual([
      "btc:default",
      "evm:ethereum",
      "evm:base",
      "evm:monad",
      "sol:default",
      "trx:default",
    ]);

    const { filePath } = resolveWalletKeystorePaths(env);
    const raw = await fs.readFile(filePath, "utf8");
    const stat = await fs.stat(filePath);
    expect((stat.mode & 0o777).toString(8)).toBe("600");
    expect(raw).not.toContain(MNEMONIC);
    expect(raw).not.toContain("abandon");
    expect(JSON.stringify(result.summary)).not.toContain("abandon");

    const unlocked = await unlockWalletMnemonic({
      env,
      passphrase: "correct horse battery staple",
    });
    expect(unlocked).toBe(MNEMONIC);
  });

  it("rejects an incorrect passphrase", async () => {
    const { env } = await tempEnv();
    await initWallet({
      env,
      mnemonic: MNEMONIC,
      passphrase: "right passphrase",
    });

    await expect(unlockWalletMnemonic({ env, passphrase: "wrong passphrase" })).rejects.toThrow(
      /Unable to decrypt/,
    );
  });

  it("manages one recovery phrase for every local keystore chain", async () => {
    const { env } = await tempEnv();
    const generated = await setWalletRecoveryPhrase({
      env,
      mode: "generate",
      passphrase: "fresh local passphrase",
    });

    expect(generated.mnemonicGenerated).toBe(true);
    expect(generated.mnemonic?.split(/\s+/)).toHaveLength(24);
    expect(generated.summary.accounts.map((account) => account.id)).toEqual([
      "btc:default",
      "evm:ethereum",
      "evm:base",
      "evm:monad",
      "sol:default",
      "trx:default",
    ]);

    const imported = await setWalletRecoveryPhrase({
      env,
      mode: "import",
      mnemonic: MNEMONIC,
      passphrase: "replacement passphrase",
      overwrite: true,
    });

    expect(imported.mnemonicGenerated).toBe(false);
    expect(imported.mnemonic).toBeUndefined();
    expect(imported.summary.accounts.map((account) => account.id)).toEqual([
      "btc:default",
      "evm:ethereum",
      "evm:base",
      "evm:monad",
      "sol:default",
      "trx:default",
    ]);
    expect(JSON.stringify(imported)).not.toContain("abandon");

    const unlocked = await unlockWalletMnemonic({
      env,
      passphrase: "replacement passphrase",
    });
    expect(unlocked).toBe(MNEMONIC);
  });

  it("allows recovery phrase management without a passphrase", async () => {
    const { env } = await tempEnv();
    const generated = await setWalletRecoveryPhrase({
      env,
      mode: "generate",
    });

    expect(generated.mnemonicGenerated).toBe(true);
    expect(generated.mnemonic?.split(/\s+/)).toHaveLength(24);

    const imported = await setWalletRecoveryPhrase({
      env,
      mode: "import",
      mnemonic: MNEMONIC,
      overwrite: true,
    });

    expect(imported.mnemonicGenerated).toBe(false);
    expect(imported.mnemonic).toBeUndefined();
    await expect(unlockWalletMnemonic({ env, passphrase: "" })).resolves.toBe(MNEMONIC);
  });

  it("signs a message without exposing private material", async () => {
    const { env } = await tempEnv();
    await initWallet({
      env,
      mnemonic: MNEMONIC,
      passphrase: "correct horse battery staple",
    });

    const result = await signWalletMessage({
      env,
      chain: "evm",
      accountId: "evm:base",
      message: "hello",
      passphrase: "correct horse battery staple",
      guard: { yes: true },
    });

    expect(result.accountId).toBe("evm:base");
    expect(result.network).toBe("base");
    expect(verifyMessage("hello", result.signature)).toBe(result.address);
    expect(JSON.stringify(result)).not.toContain("abandon");
  });
});
