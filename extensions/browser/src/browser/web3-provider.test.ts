import vm from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildWeb3ProviderScript,
  ensureWeb3HttpBridge,
  resolveWeb3ProviderInitScript,
} from "./web3-provider.js";

// Same slot the node runner fills via setWalletWeb3GatewayForwarder.
const FORWARDER_KEY = Symbol.for("genesis.wallet.web3.forwarder");

function runProviderScript(params: {
  origin: string;
  allowedOrigins?: string[];
  respond: (payload: { chain: string; method: string; params?: unknown }) => unknown;
}) {
  const target = new EventTarget();
  const binding = vi.fn(async (payload: { chain: string; method: string; params?: unknown }) => {
    try {
      return { ok: true, result: params.respond(payload) };
    } catch (error) {
      return { ok: false, code: 4001, message: String(error) };
    }
  });
  const window: Record<string, unknown> = {
    __genesisWeb3Request: binding,
    addEventListener: target.addEventListener.bind(target),
    dispatchEvent: target.dispatchEvent.bind(target),
  };
  const context = vm.createContext({
    window,
    location: { origin: params.origin },
    crypto: globalThis.crypto,
    CustomEvent,
    Event,
    atob,
    btoa,
    Uint8Array,
    JSON,
  });
  vm.runInContext(buildWeb3ProviderScript(params.allowedOrigins ?? []), context);
  return { window, binding, target };
}

const EVM_ADDRESS = "0x0000000000000000000000000000000000000001";

function respondDefault(payload: { chain: string; method: string; params?: unknown }) {
  if (payload.method === "genesis_providerState") {
    return { chainId: "0x1", accounts: [EVM_ADDRESS] };
  }
  if (payload.method === "wallet_switchEthereumChain") {
    return { chainId: (payload.params as Array<{ chainId: string }>)[0].chainId };
  }
  if (payload.method === "connect") {
    return {
      address: "Sol111",
      publicKey: Buffer.alloc(32, 1).toString("base64"),
      chain: "solana:mainnet",
    };
  }
  if (payload.method === "eth_accounts") {
    return [EVM_ADDRESS];
  }
  throw new Error("user rejected");
}

describe("injected web3 provider script", () => {
  it("exposes an EIP-1193 provider that tracks chain switches", async () => {
    const { window, binding } = runProviderScript({
      origin: "https://dapp.example",
      respond: respondDefault,
    });
    const ethereum = window.ethereum as {
      request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
      on: (event: string, fn: (value: unknown) => void) => void;
      chainId: string | null;
    };
    expect(ethereum).toBeDefined();
    await vi.waitFor(() => expect(ethereum.chainId).toBe("0x1"));

    const changed = vi.fn();
    ethereum.on("chainChanged", changed);
    await expect(
      ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x2105" }] }),
    ).resolves.toBeNull();
    expect(changed).toHaveBeenCalledWith("0x2105");
    await ethereum.request({ method: "eth_accounts" });
    expect(binding).toHaveBeenLastCalledWith(
      expect.objectContaining({ chain: "evm", method: "eth_accounts", chainId: "0x2105" }),
    );
    await expect(ethereum.request({ method: "personal_sign" })).rejects.toMatchObject({
      code: 4001,
    });
  });

  it("announces via EIP-6963 and registers a Solana Wallet Standard wallet", async () => {
    const { window, target } = runProviderScript({
      origin: "https://dapp.example",
      respond: respondDefault,
    });
    const announced = vi.fn();
    target.addEventListener("eip6963:announceProvider", (event) =>
      announced((event as CustomEvent).detail.info.name),
    );
    target.dispatchEvent(new Event("eip6963:requestProvider"));
    expect(announced).toHaveBeenCalledWith("Genesis");

    const registered: Array<{ name: string; features: Record<string, unknown> }> = [];
    target.dispatchEvent(
      new CustomEvent("wallet-standard:app-ready", {
        detail: { register: (wallet: (typeof registered)[number]) => registered.push(wallet) },
      }),
    );
    expect(registered[0]?.name).toBe("Genesis");
    const connect = registered[0].features["standard:connect"] as {
      connect: () => Promise<{ accounts: Array<{ address: string }> }>;
    };
    await expect(connect.connect()).resolves.toMatchObject({ accounts: [{ address: "Sol111" }] });
    expect(window.solana).toBeDefined();
  });

  it("stays out of pages outside the origin allowlist", () => {
    const { window } = runProviderScript({
      origin: "https://evil.example",
      allowedOrigins: ["https://dapp.example"],
      respond: respondDefault,
    });
    expect(window.ethereum).toBeUndefined();
    expect(window.solana).toBeUndefined();
  });
});

describe("web3 gateway forwarding and HTTP bridge", () => {
  afterEach(() => {
    delete (globalThis as Record<PropertyKey, unknown>)[FORWARDER_KEY];
  });

  it("asks the gateway for provider config and forwards bridge requests with the browser origin", async () => {
    const forwarder = vi.fn(async (params: { op: string }) =>
      params.op === "config"
        ? { enabled: true, allowedOrigins: ["https://dapp.example"] }
        : { ok: true, result: ["0xabc"] },
    );
    (globalThis as Record<PropertyKey, unknown>)[FORWARDER_KEY] = forwarder;

    const script = await resolveWeb3ProviderInitScript();
    const { url, token } = await ensureWeb3HttpBridge();
    expect(script).toContain(url);
    expect(script).toContain('"https://dapp.example"');

    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "text/plain", origin: "https://dapp.example" },
      body: JSON.stringify({
        token,
        chain: "evm",
        method: "eth_accounts",
        origin: "https://spoof",
      }),
    });
    expect(response.headers.get("access-control-allow-origin")).toBe("https://dapp.example");
    await expect(response.json()).resolves.toEqual({ ok: true, result: ["0xabc"] });
    expect(forwarder).toHaveBeenLastCalledWith({
      op: "request",
      chain: "evm",
      origin: "https://dapp.example",
      method: "eth_accounts",
      params: undefined,
      chainId: undefined,
    });
  });

  it("rejects bridge calls without the token and answers private-network preflight", async () => {
    const { url } = await ensureWeb3HttpBridge();
    const denied = await fetch(url, {
      method: "POST",
      headers: { origin: "https://dapp.example" },
      body: JSON.stringify({ token: "wrong", chain: "evm", method: "eth_accounts" }),
    });
    expect(denied.status).toBe(403);
    const preflight = await fetch(url, {
      method: "OPTIONS",
      headers: { origin: "https://dapp.example" },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-private-network")).toBe("true");
  });

  it("skips injection when the gateway reports the provider disabled", async () => {
    (globalThis as Record<PropertyKey, unknown>)[FORWARDER_KEY] = async () => ({
      enabled: false,
      allowedOrigins: [],
    });
    await expect(resolveWeb3ProviderInitScript()).resolves.toBeUndefined();
  });
});
