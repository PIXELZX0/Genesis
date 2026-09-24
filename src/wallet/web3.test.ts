import { verify as verifyEd25519, createPublicKey } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";
import { verifyMessage } from "ethers";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { WalletConfig } from "../config/types.wallet.js";

let walletConfig: WalletConfig = {};
vi.mock("../config/config.js", () => ({ loadConfig: () => ({ wallet: walletConfig }) }));

const { initWallet } = await import("./service.js");
const { lockWalletSession, unlockWalletSession } = await import("./session.js");
const {
  approveWalletWeb3Request,
  handleWalletWeb3Request,
  listWalletWeb3PendingRequests,
  rejectWalletWeb3Request,
} = await import("./web3.js");

const MNEMONIC = "test test test test test test test test test test test junk";
const ORIGIN = "https://dapp.example";
const baseConfig: WalletConfig = { browser: { enabled: true }, spending: { enabled: true } };

let stateDir: string;
let evmAddress: string;
let solAddress: string;

async function nextPendingId(): Promise<string> {
  await vi.waitFor(() => expect(listWalletWeb3PendingRequests().length).toBeGreaterThan(0));
  return listWalletWeb3PendingRequests()[0].id;
}

beforeAll(async () => {
  stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "genesis-web3-test-"));
  vi.stubEnv("GENESIS_STATE_DIR", stateDir);
  const { summary } = await initWallet({
    config: baseConfig,
    mnemonic: MNEMONIC,
    passphrase: "pw",
    chains: ["evm", "sol"],
  });
  evmAddress = summary.accounts.find((account) => account.chain === "evm")!.address;
  solAddress = summary.accounts.find((account) => account.chain === "sol")!.address;
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await fs.rm(stateDir, { recursive: true, force: true });
});

beforeEach(() => {
  vi.stubEnv("GENESIS_STATE_DIR", stateDir);
  walletConfig = baseConfig;
  lockWalletSession();
  for (const request of listWalletWeb3PendingRequests()) {
    rejectWalletWeb3Request(request.id);
  }
});

describe("wallet web3 provider", () => {
  it("refuses when disabled or origin is not allowlisted", async () => {
    walletConfig = { browser: { enabled: false } };
    await expect(
      handleWalletWeb3Request({ chain: "evm", origin: ORIGIN, method: "eth_accounts" }),
    ).rejects.toMatchObject({ code: 4100 });
    walletConfig = { browser: { enabled: true, allowedOrigins: ["https://other.example"] } };
    await expect(
      handleWalletWeb3Request({ chain: "evm", origin: ORIGIN, method: "eth_accounts" }),
    ).rejects.toMatchObject({ code: 4100 });
  });

  it("answers EVM account and chain methods without approval", async () => {
    await expect(
      handleWalletWeb3Request({ chain: "evm", origin: ORIGIN, method: "eth_requestAccounts" }),
    ).resolves.toEqual([evmAddress]);
    await expect(
      handleWalletWeb3Request({ chain: "evm", origin: ORIGIN, method: "eth_chainId" }),
    ).resolves.toBe("0x1");
    await expect(
      handleWalletWeb3Request({
        chain: "evm",
        origin: ORIGIN,
        method: "wallet_switchEthereumChain",
        params: [{ chainId: "0x2105" }],
      }),
    ).resolves.toEqual({ chainId: "0x2105" });
    await expect(
      handleWalletWeb3Request({
        chain: "evm",
        origin: ORIGIN,
        method: "wallet_switchEthereumChain",
        params: [{ chainId: "0x999999" }],
      }),
    ).rejects.toMatchObject({ code: 4902 });
    await expect(
      handleWalletWeb3Request({ chain: "evm", origin: ORIGIN, method: "eth_sign" }),
    ).rejects.toMatchObject({ code: 4200 });
  });

  it("queues personal_sign until approved with an unlocked wallet", async () => {
    const pending = handleWalletWeb3Request({
      chain: "evm",
      origin: ORIGIN,
      method: "personal_sign",
      params: ["0x68656c6c6f", evmAddress],
    });
    const id = await nextPendingId();
    expect(listWalletWeb3PendingRequests()[0]).toMatchObject({
      origin: ORIGIN,
      method: "personal_sign",
      details: { message: "hello" },
    });

    await expect(approveWalletWeb3Request(id)).rejects.toThrow(/locked/);
    expect(listWalletWeb3PendingRequests()).toHaveLength(1);

    await unlockWalletSession({ passphrase: "pw" });
    await approveWalletWeb3Request(id);
    const signature = (await pending) as string;
    expect(verifyMessage("hello", signature)).toBe(evmAddress);
    expect(listWalletWeb3PendingRequests()).toHaveLength(0);
  });

  it("rejects the page promise with 4001 when the agent rejects", async () => {
    const pending = handleWalletWeb3Request({
      chain: "evm",
      origin: ORIGIN,
      method: "personal_sign",
      params: ["hi", evmAddress],
    });
    rejectWalletWeb3Request(await nextPendingId(), "not mine");
    await expect(pending).rejects.toMatchObject({ code: 4001, message: "not mine" });
  });

  it("blocks transactions when wallet spending is disabled", async () => {
    walletConfig = { browser: { enabled: true } };
    await expect(
      handleWalletWeb3Request({
        chain: "evm",
        origin: ORIGIN,
        method: "eth_sendTransaction",
        params: [{ to: evmAddress, value: "0x1" }],
      }),
    ).rejects.toMatchObject({ code: 4100 });
    await expect(
      handleWalletWeb3Request({
        chain: "sol",
        origin: ORIGIN,
        method: "signTransaction",
        params: { transaction: "AA==" },
      }),
    ).rejects.toMatchObject({ code: 4100 });
  });

  it("signs Solana messages and transactions after approval", async () => {
    await unlockWalletSession({ passphrase: "pw" });
    const connected = (await handleWalletWeb3Request({
      chain: "sol",
      origin: ORIGIN,
      method: "connect",
    })) as { address: string; publicKey: string; chain: string };
    expect(connected).toMatchObject({ address: solAddress, chain: "solana:mainnet" });

    const message = Buffer.from("gm");
    const signedMessage = handleWalletWeb3Request({
      chain: "sol",
      origin: ORIGIN,
      method: "signMessage",
      params: { message: message.toString("base64") },
    });
    await approveWalletWeb3Request(await nextPendingId());
    const { signature } = (await signedMessage) as { signature: string };
    const spki = Buffer.concat([
      Buffer.from("302a300506032b6570032100", "hex"),
      Buffer.from(new PublicKey(solAddress).toBytes()),
    ]);
    expect(
      verifyEd25519(
        null,
        message,
        createPublicKey({ key: spki, format: "der", type: "spki" }),
        Buffer.from(signature, "base64"),
      ),
    ).toBe(true);

    const tx = new Transaction({
      feePayer: new PublicKey(solAddress),
      recentBlockhash: Keypair.generate().publicKey.toBase58(),
    }).add(
      SystemProgram.transfer({
        fromPubkey: new PublicKey(solAddress),
        toPubkey: Keypair.generate().publicKey,
        lamports: 1,
      }),
    );
    const signedTx = handleWalletWeb3Request({
      chain: "sol",
      origin: ORIGIN,
      method: "signTransaction",
      params: {
        transaction: tx
          .serialize({ requireAllSignatures: false, verifySignatures: false })
          .toString("base64"),
      },
    });
    const id = await nextPendingId();
    expect(listWalletWeb3PendingRequests()[0].details).toMatchObject({
      transactions: [{ programs: ["11111111111111111111111111111111"] }],
    });
    await approveWalletWeb3Request(id);
    const result = (await signedTx) as { signedTransaction: string; signature: string };
    const decoded = VersionedTransaction.deserialize(
      Buffer.from(result.signedTransaction, "base64"),
    );
    tx.addSignature(new PublicKey(solAddress), Buffer.from(result.signature, "base64"));
    expect(tx.verifySignatures()).toBe(true);
    expect(Buffer.from(decoded.signatures[0]).toString("base64")).toBe(result.signature);
  });
});
