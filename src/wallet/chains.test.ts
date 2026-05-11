import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import {
  AbiCoder,
  Transaction as EvmTransaction,
  ZeroAddress,
  recoverAddress,
  verifyMessage,
} from "ethers";
import { describe, expect, it } from "vitest";
import {
  derivePublicAccounts,
  getWalletNftCollections,
  getWalletTokenBalances,
  resolveEvmNetworks,
  signWalletDigestPayload,
  signWalletMessagePayload,
  signWalletRawTransactionPayload,
} from "./chains.js";

const MNEMONIC =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const TEST_EVM_ADDRESS = "0x9858EfFD232B4033E47d90003D41EC34EcaEda94";
const TEST_ERC20_CONTRACT = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const TEST_ERC721_CONTRACT = "0x0000000000000000000000000000000000000001";

async function readRequestBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function withJsonRpcServer<T>(
  handler: (method: string, params: unknown[] | Record<string, unknown>) => unknown,
  run: (url: string) => Promise<T>,
): Promise<T> {
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    void (async () => {
      const body = await readRequestBody(request);
      const payload = JSON.parse(body) as
        | { id: number; method: string; params: unknown[] | Record<string, unknown> }
        | Array<{ id: number; method: string; params: unknown[] | Record<string, unknown> }>;
      const requests = Array.isArray(payload) ? payload : [payload];
      const results = requests.map((entry) => ({
        jsonrpc: "2.0",
        id: entry.id,
        result: handler(entry.method, entry.params),
      }));
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(Array.isArray(payload) ? results : results[0]));
    })().catch((error: unknown) => {
      response.writeHead(500, { "content-type": "text/plain" });
      response.end(error instanceof Error ? error.message : String(error));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("test JSON-RPC server did not bind to a TCP port");
  }
  try {
    return await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

function jsonRpcAssetHandler(method: string, params: unknown[] | Record<string, unknown>) {
  const abi = AbiCoder.defaultAbiCoder();
  if (method === "eth_chainId") {
    return "0x1";
  }
  if (method !== "eth_call" || !Array.isArray(params)) {
    throw new Error(`unexpected JSON-RPC method ${method}`);
  }
  const call = params[0] as { to?: string; data?: string };
  const to = call.to?.toLowerCase();
  const data = call.data?.toLowerCase() ?? "";
  if (to === TEST_ERC20_CONTRACT.toLowerCase() && data.startsWith("0x70a08231")) {
    return abi.encode(["uint256"], [1_500_000n]);
  }
  if (to === TEST_ERC721_CONTRACT.toLowerCase() && data.startsWith("0x70a08231")) {
    return abi.encode(["uint256"], [1n]);
  }
  if (to === TEST_ERC721_CONTRACT.toLowerCase() && data.startsWith("0x6352211e")) {
    const tokenId = BigInt(`0x${data.slice(-64)}`);
    return abi.encode(["address"], [tokenId === 1n ? TEST_EVM_ADDRESS : ZeroAddress]);
  }
  if (to === TEST_ERC721_CONTRACT.toLowerCase() && data.startsWith("0xc87b56dd")) {
    return abi.encode(["string"], ["ipfs://badge/1"]);
  }
  throw new Error(`unexpected eth_call to ${to ?? "missing"} with ${data}`);
}

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

  it("reads configured EVM token balances and NFT holdings", async () => {
    await withJsonRpcServer(jsonRpcAssetHandler, async (rpcUrl) => {
      const accounts = await derivePublicAccounts({
        mnemonic: MNEMONIC,
        config: {
          networks: {
            evm: {
              chains: {
                ethereum: {
                  rpcUrl,
                  tokens: {
                    usdc: {
                      address: TEST_ERC20_CONTRACT,
                      symbol: "USDC",
                      name: "USD Coin",
                      decimals: 6,
                    },
                  },
                  nfts: {
                    badge: {
                      address: TEST_ERC721_CONTRACT,
                      standard: "erc721",
                      name: "Badge",
                      tokenIds: ["1", "2"],
                    },
                  },
                },
                base: { enabled: false },
                monad: { enabled: false },
              },
            },
          },
        },
      });
      const config = {
        networks: {
          evm: {
            chains: {
              ethereum: {
                rpcUrl,
                tokens: {
                  usdc: {
                    address: TEST_ERC20_CONTRACT,
                    symbol: "USDC",
                    name: "USD Coin",
                    decimals: 6,
                  },
                },
                nfts: {
                  badge: {
                    address: TEST_ERC721_CONTRACT,
                    standard: "erc721" as const,
                    name: "Badge",
                    tokenIds: ["1", "2"],
                  },
                },
              },
              base: { enabled: false },
              monad: { enabled: false },
            },
          },
        },
      };

      await expect(getWalletTokenBalances({ accounts, config })).resolves.toEqual([
        {
          chain: "evm",
          accountId: "evm:ethereum",
          address: TEST_EVM_ADDRESS,
          network: "ethereum",
          tokenId: "usdc",
          contractAddress: TEST_ERC20_CONTRACT,
          asset: "USDC",
          name: "USD Coin",
          decimals: 6,
          amountAtomic: "1500000",
          amount: "1.5",
        },
      ]);

      await expect(getWalletNftCollections({ accounts, config })).resolves.toEqual([
        {
          chain: "evm",
          accountId: "evm:ethereum",
          address: TEST_EVM_ADDRESS,
          network: "ethereum",
          collectionId: "badge",
          contractAddress: TEST_ERC721_CONTRACT,
          standard: "erc721",
          name: "Badge",
          balance: "1",
          tokens: [{ tokenId: "1", amount: "1", tokenUri: "ipfs://badge/1" }],
        },
      ]);
    });
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
