import { Transaction as EvmTransaction, recoverAddress, verifyMessage } from "ethers";
import { describe, expect, it } from "vitest";
import {
  derivePublicAccounts,
  resolveEvmNetworks,
  signWalletDigestPayload,
  signWalletMessagePayload,
  signWalletRawTransactionPayload,
} from "./chains.js";

const MNEMONIC =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

describe("wallet chain derivation", () => {
  it("derives deterministic public addresses for local keystore chains", async () => {
    const accounts = await derivePublicAccounts({ mnemonic: MNEMONIC });
    const byId = Object.fromEntries(accounts.map((account) => [account.id, account]));

    expect(accounts.map((account) => account.id)).toEqual([
      "btc:default",
      "evm:ethereum",
      "evm:base",
      "evm:monad",
      "sol:default",
      "trx:default",
    ]);
    expect(byId["btc:default"]?.address).toBe("bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu");
    expect(byId["evm:ethereum"]?.address).toBe("0x9858EfFD232B4033E47d90003D41EC34EcaEda94");
    expect(byId["evm:base"]?.address).toBe("0x9858EfFD232B4033E47d90003D41EC34EcaEda94");
    expect(byId["evm:monad"]?.address).toBe("0x9858EfFD232B4033E47d90003D41EC34EcaEda94");
    expect(byId["sol:default"]?.address).toBe("HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk");
    expect(byId["trx:default"]?.address).toBe("TUEZSdKsoDHQMeZwihtdoBiN46zxhGWYdH");
    expect(byId["evm:ethereum"]?.network).toBe("ethereum");
    expect(byId["evm:base"]?.network).toBe("base");
    expect(byId["evm:monad"]?.network).toBe("monad");
  });

  it("uses public RPC defaults for built-in EVM chains", () => {
    expect(
      resolveEvmNetworks().map(({ accountId, chainId, currencySymbol, name, rpcUrl }) => ({
        accountId,
        chainId,
        currencySymbol,
        name,
        rpcUrl,
      })),
    ).toEqual([
      {
        accountId: "evm:ethereum",
        chainId: 1,
        currencySymbol: "ETH",
        name: "ethereum",
        rpcUrl: "https://ethereum-rpc.publicnode.com",
      },
      {
        accountId: "evm:base",
        chainId: 8453,
        currencySymbol: "ETH",
        name: "base",
        rpcUrl: "https://mainnet.base.org",
      },
      {
        accountId: "evm:monad",
        chainId: 143,
        currencySymbol: "MON",
        name: "monad",
        rpcUrl: "https://rpc.monad.xyz",
      },
    ]);
  });

  it("fills known legacy EVM chain configs with matching public RPC defaults", () => {
    expect(resolveEvmNetworks({ chainId: 8453 })).toMatchObject([
      {
        accountId: "evm:default",
        chainId: 8453,
        name: "base",
        rpcUrl: "https://mainnet.base.org",
      },
    ]);
    expect(resolveEvmNetworks({ name: "monad" })).toMatchObject([
      {
        accountId: "evm:default",
        chainId: 143,
        name: "monad",
        rpcUrl: "https://rpc.monad.xyz",
      },
    ]);
  });

  it("signs EVM messages, digests, and raw transactions from wallet accounts", async () => {
    const accounts = await derivePublicAccounts({ mnemonic: MNEMONIC });
    const address = "0x9858EfFD232B4033E47d90003D41EC34EcaEda94";

    const message = await signWalletMessagePayload({
      chain: "evm",
      accounts,
      accountId: "evm:ethereum",
      mnemonic: MNEMONIC,
      message: "hello",
    });
    expect(message.payloadKind).toBe("message");
    expect(verifyMessage("hello", message.signature)).toBe(address);

    const digest = "0x0000000000000000000000000000000000000000000000000000000000000001";
    const digestSignature = await signWalletDigestPayload({
      chain: "evm",
      accounts,
      accountId: "evm:ethereum",
      mnemonic: MNEMONIC,
      digest,
    });
    expect(digestSignature.digest).toBe(digest);
    expect(recoverAddress(digest, digestSignature.signature)).toBe(address);

    const signed = await signWalletRawTransactionPayload({
      chain: "evm",
      accounts,
      accountId: "evm:ethereum",
      mnemonic: MNEMONIC,
      transaction: {
        to: "0x0000000000000000000000000000000000000001",
        nonce: 0,
        gasLimit: "21000",
        gasPrice: "1",
        value: "1",
      },
    });
    const parsed = EvmTransaction.from(signed.rawTransaction);
    expect(parsed.from).toBe(address);
    expect(parsed.chainId).toBe(1n);
    expect(parsed.to).toBe("0x0000000000000000000000000000000000000001");
    expect(parsed.value).toBe(1n);
    expect(signed.txId).toBe(parsed.hash);
  });

  it("rejects explicit EVM accounts that are missing or disabled", async () => {
    const accounts = await derivePublicAccounts({ mnemonic: MNEMONIC });

    await expect(
      signWalletMessagePayload({
        chain: "evm",
        accounts,
        accountId: "evm:missing",
        mnemonic: MNEMONIC,
        message: "hello",
      }),
    ).rejects.toThrow(/Wallet account not found for evm: evm:missing/);

    await expect(
      signWalletMessagePayload({
        chain: "evm",
        accounts,
        accountId: "evm:base",
        mnemonic: MNEMONIC,
        message: "hello",
        config: { networks: { evm: { chains: { base: { enabled: false } } } } },
      }),
    ).rejects.toThrow(/not enabled for account evm:base/);
  });
});
