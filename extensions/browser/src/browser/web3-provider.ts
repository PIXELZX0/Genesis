import { randomBytes, timingSafeEqual } from "node:crypto";
import http from "node:http";
import type { BrowserContext } from "playwright-core";
import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("browser").child("web3");

const WEB3_BINDING = "__genesisWeb3Request";
const WEB3_HTTP_MAX_BODY_BYTES = 1024 * 1024;
const installedContexts = new WeakSet<BrowserContext>();

type Web3Envelope = { ok: true; result: unknown } | { ok: false; code: number; message: string };

export type Web3ProviderTransport =
  | { kind: "binding" }
  | { kind: "http"; url: string; token: string };

function loadWalletRuntime() {
  return import("genesis/plugin-sdk/wallet-runtime");
}

function errorEnvelope(code: number, error: unknown): Web3Envelope {
  return { ok: false, code, message: error instanceof Error ? error.message : String(error) };
}

/**
 * Where the provider should appear, or null when disabled. Node hosts ask the
 * gateway (its wallet config is the source of truth); the gateway reads its own.
 */
export async function resolveWeb3ProviderConfig(): Promise<{ allowedOrigins: string[] } | null> {
  const runtime = await loadWalletRuntime();
  const forwarder = runtime.getWalletWeb3GatewayForwarder();
  const config = forwarder
    ? ((await forwarder({ op: "config" })) as { enabled?: boolean; allowedOrigins?: string[] })
    : runtime.getWalletBrowserProviderConfig();
  return config?.enabled === true ? { allowedOrigins: config.allowedOrigins ?? [] } : null;
}

function toOrigin(url: string | undefined): string | null {
  if (!url) {
    return null;
  }
  try {
    const origin = new URL(url).origin;
    return origin === "null" ? null : origin;
  } catch {
    return null;
  }
}

/** Dispatch one page request; `origin` must come from the browser, never page JS. */
export async function handleWeb3ProviderCall(
  origin: string | null,
  payload: unknown,
): Promise<Web3Envelope> {
  const input = (payload ?? {}) as Record<string, unknown>;
  if (!origin) {
    return { ok: false, code: 4100, message: "Web3 provider is unavailable on opaque origins." };
  }
  if ((input.chain !== "evm" && input.chain !== "sol") || typeof input.method !== "string") {
    return { ok: false, code: -32602, message: "Invalid web3 request." };
  }
  const request = {
    chain: input.chain,
    origin,
    method: input.method,
    params: input.params,
    chainId: typeof input.chainId === "string" ? input.chainId : undefined,
  } as const;
  const runtime = await loadWalletRuntime();
  const forwarder = runtime.getWalletWeb3GatewayForwarder();
  if (forwarder) {
    try {
      return (await forwarder({ op: "request", ...request })) as Web3Envelope;
    } catch (error) {
      return errorEnvelope(4900, error);
    }
  }
  try {
    return { ok: true, result: (await runtime.handleWalletWeb3Request(request)) ?? null };
  } catch (error) {
    return errorEnvelope(error instanceof runtime.WalletWeb3Error ? error.code : -32603, error);
  }
}

/**
 * Injects an EIP-1193/EIP-6963 EVM provider and a Solana Wallet Standard wallet
 * (plus window.solana) into every page of the context through a Playwright
 * binding. The host resolves the caller origin from the frame. Pages that were
 * already open pick it up on their next navigation.
 */
export async function installWalletWeb3Provider(context: BrowserContext): Promise<void> {
  if (installedContexts.has(context)) {
    return;
  }
  installedContexts.add(context);
  try {
    const config = await resolveWeb3ProviderConfig();
    if (!config) {
      return;
    }
    await context.exposeBinding(WEB3_BINDING, (source, payload: unknown) =>
      handleWeb3ProviderCall(toOrigin(source.frame.url()), payload),
    );
    await context.addInitScript({ content: buildWeb3ProviderScript(config.allowedOrigins) });
  } catch (error) {
    log.warn(`web3 provider injection failed: ${String(error)}`);
  }
}

// ---------------------------------------------------------------------------
// Loopback HTTP bridge for drivers without bindings (Chrome DevTools MCP
// existing-session). The origin comes from the browser-set Origin header.

let httpBridge: Promise<{ url: string; token: string }> | undefined;

function tokenMatches(expected: string, actual: unknown): boolean {
  if (typeof actual !== "string" || actual.length !== expected.length) {
    return false;
  }
  return timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}

async function readBody(req: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    total += buffer.length;
    if (total > WEB3_HTTP_MAX_BODY_BYTES) {
      throw new Error("web3 bridge request too large");
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function serveBridgeRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  token: string,
): Promise<void> {
  const originHeader = typeof req.headers.origin === "string" ? req.headers.origin : undefined;
  if (originHeader) {
    res.setHeader("Access-Control-Allow-Origin", originHeader);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "POST");
    res.setHeader("Access-Control-Allow-Headers", "content-type");
    res.setHeader("Access-Control-Allow-Private-Network", "true");
  }
  if (req.method === "OPTIONS") {
    res.writeHead(204).end();
    return;
  }
  if (req.method !== "POST" || req.url !== "/web3") {
    res.writeHead(404).end();
    return;
  }
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(await readBody(req)) as Record<string, unknown>;
  } catch {
    res.writeHead(400).end();
    return;
  }
  if (!tokenMatches(token, payload.token)) {
    res.writeHead(403).end();
    return;
  }
  const envelope = await handleWeb3ProviderCall(toOrigin(originHeader), payload);
  res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(envelope));
}

export function ensureWeb3HttpBridge(): Promise<{ url: string; token: string }> {
  httpBridge ??= new Promise((resolve, reject) => {
    const token = randomBytes(24).toString("hex");
    const server = http.createServer((req, res) => {
      serveBridgeRequest(req, res, token).catch((error: unknown) => {
        log.warn(`web3 bridge request failed: ${String(error)}`);
        if (!res.headersSent) {
          res.writeHead(500).end();
        }
      });
    });
    server.once("error", (error) => {
      httpBridge = undefined;
      reject(error);
    });
    server.listen(0, "127.0.0.1", () => {
      server.unref();
      const { port } = server.address() as { port: number };
      resolve({ url: `http://127.0.0.1:${port}/web3`, token });
    });
  });
  return httpBridge;
}

/** Init script for Chrome DevTools MCP navigations, or undefined when disabled. */
export async function resolveWeb3ProviderInitScript(): Promise<string | undefined> {
  try {
    const config = await resolveWeb3ProviderConfig();
    if (!config) {
      return undefined;
    }
    const bridge = await ensureWeb3HttpBridge();
    return buildWeb3ProviderScript(config.allowedOrigins, { kind: "http", ...bridge });
  } catch (error) {
    log.warn(`web3 provider init script unavailable: ${String(error)}`);
    return undefined;
  }
}

const GENESIS_ICON =
  "data:image/svg+xml;base64," +
  Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#111"/><text x="16" y="22" font-size="18" text-anchor="middle" fill="#fff" font-family="sans-serif">G</text></svg>',
  ).toString("base64");

export function buildWeb3ProviderScript(
  allowedOrigins: readonly string[],
  transport: Web3ProviderTransport = { kind: "binding" },
): string {
  return `(() => {
  const ALLOWED = ${JSON.stringify(allowedOrigins)};
  const TRANSPORT = ${JSON.stringify(transport)};
  const ICON = ${JSON.stringify(GENESIS_ICON)};
  const BINDING = ${JSON.stringify(WEB3_BINDING)};
  if (window.__genesisWeb3Installed || location.origin === "null") return;
  if (ALLOWED.length && !ALLOWED.includes(location.origin)) return;
  Object.defineProperty(window, "__genesisWeb3Installed", { value: true });

  const send = async (payload) => {
    if (TRANSPORT.kind !== "http") return window[BINDING](payload);
    try {
      const response = await fetch(TRANSPORT.url, {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: JSON.stringify({ ...payload, token: TRANSPORT.token }),
        credentials: "omit",
      });
      return await response.json();
    } catch (error) {
      return { ok: false, code: 4900, message: "Genesis wallet bridge unreachable: " + error };
    }
  };
  const rpc = async (chain, method, params, chainId) => {
    const res = await send({ chain, method, params, chainId });
    if (res && res.ok) return res.result;
    const err = new Error((res && res.message) || "Wallet request failed");
    err.code = (res && res.code) || -32603;
    throw err;
  };
  const emitter = () => {
    const map = new Map();
    return {
      on(event, fn) { map.set(event, [...(map.get(event) || []), fn]); },
      off(event, fn) { map.set(event, (map.get(event) || []).filter((f) => f !== fn)); },
      emit(event, ...args) { for (const fn of map.get(event) || []) { try { fn(...args); } catch {} } },
    };
  };

  // EVM: EIP-1193 + EIP-6963
  const evmEvents = emitter();
  let chainId = null;
  let accounts = [];
  const setAccounts = (next) => {
    if (JSON.stringify(next) !== JSON.stringify(accounts)) {
      accounts = next;
      evmEvents.emit("accountsChanged", next);
    }
  };
  const ethereum = {
    isGenesis: true,
    isMetaMask: true,
    get chainId() { return chainId; },
    get networkVersion() { return chainId ? String(parseInt(chainId, 16)) : null; },
    get selectedAddress() { return accounts[0] || null; },
    isConnected: () => true,
    async request(args) {
      const method = args && args.method;
      const params = args && args.params;
      const result = await rpc("evm", method, params, chainId || undefined);
      if (method === "wallet_switchEthereumChain" || method === "wallet_addEthereumChain") {
        if (result.chainId !== chainId) { chainId = result.chainId; evmEvents.emit("chainChanged", chainId); }
        return null;
      }
      if (method === "eth_requestAccounts" || method === "eth_accounts") setAccounts(result);
      if (method === "eth_chainId") chainId = result;
      return result;
    },
    enable() { return ethereum.request({ method: "eth_requestAccounts" }); },
    send(methodOrPayload, paramsOrCallback) {
      if (typeof methodOrPayload === "string") {
        return ethereum.request({ method: methodOrPayload, params: paramsOrCallback });
      }
      return ethereum.sendAsync(methodOrPayload, paramsOrCallback);
    },
    sendAsync(payload, callback) {
      ethereum.request(payload).then(
        (result) => callback && callback(null, { id: payload.id, jsonrpc: "2.0", result }),
        (error) => callback && callback(error, null),
      );
    },
    on(event, fn) { evmEvents.on(event, fn); return ethereum; },
    once(event, fn) { const wrap = (...a) => { evmEvents.off(event, wrap); fn(...a); }; evmEvents.on(event, wrap); return ethereum; },
    removeListener(event, fn) { evmEvents.off(event, fn); return ethereum; },
    off(event, fn) { evmEvents.off(event, fn); return ethereum; },
    removeAllListeners() { return ethereum; },
  };
  rpc("evm", "genesis_providerState").then((state) => {
    chainId = state.chainId;
    accounts = state.accounts;
    evmEvents.emit("connect", { chainId });
  }, () => {});
  if (!window.ethereum) {
    Object.defineProperty(window, "ethereum", { value: ethereum, configurable: true, writable: true });
  }
  const info = Object.freeze({
    uuid: (crypto.randomUUID && crypto.randomUUID()) || "genesis-" + Math.random().toString(16).slice(2),
    name: "Genesis",
    icon: ICON,
    rdns: "ai.genesis.wallet",
  });
  const announce = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", {
    detail: Object.freeze({ info, provider: ethereum }),
  }));
  window.addEventListener("eip6963:requestProvider", announce);
  announce();
  window.dispatchEvent(new Event("ethereum#initialized"));

  // Solana: Wallet Standard + window.solana
  const toBytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const toB64 = (bytes) => { let s = ""; for (const b of bytes) s += String.fromCharCode(b); return btoa(s); };
  const serializeTx = (tx) => tx instanceof Uint8Array
    ? tx
    : ("version" in tx ? tx.serialize() : tx.serialize({ requireAllSignatures: false, verifySignatures: false }));
  let solAccount = null;
  const solConnect = async () => {
    if (!solAccount) {
      const r = await rpc("sol", "connect");
      solAccount = { address: r.address, publicKey: toBytes(r.publicKey), chain: r.chain };
    }
    return solAccount;
  };
  const signTxs = async (list) => {
    const encoded = list.map((tx) => toB64(serializeTx(tx)));
    if (encoded.length === 1) return [await rpc("sol", "signTransaction", { transaction: encoded[0] })];
    return (await rpc("sol", "signAllTransactions", { transactions: encoded })).signed;
  };
  const applySignature = (tx, signed) => {
    if (tx instanceof Uint8Array) return toBytes(signed.signedTransaction);
    const address = solAccount.address;
    const key = "version" in tx
      ? tx.message.staticAccountKeys.find((k) => k.toBase58() === address)
      : (tx.signatures.find((s) => s.publicKey.toBase58() === address) || {}).publicKey;
    tx.addSignature(key, toBytes(signed.signature));
    return tx;
  };
  const solEvents = emitter();
  const publicKeyObject = (account) => ({
    toBase58: () => account.address,
    toString: () => account.address,
    toJSON: () => account.address,
    toBytes: () => account.publicKey.slice(),
    toBuffer: () => account.publicKey.slice(),
    equals: (other) => Boolean(other && other.toBase58 && other.toBase58() === account.address),
  });
  const solana = {
    isGenesis: true,
    publicKey: null,
    isConnected: false,
    async connect() {
      const account = await solConnect();
      solana.publicKey = publicKeyObject(account);
      solana.isConnected = true;
      solEvents.emit("connect", solana.publicKey);
      return { publicKey: solana.publicKey };
    },
    async disconnect() { solana.publicKey = null; solana.isConnected = false; solEvents.emit("disconnect"); },
    async signTransaction(tx) { await solConnect(); return applySignature(tx, (await signTxs([tx]))[0]); },
    async signAllTransactions(txs) {
      await solConnect();
      const signed = await signTxs(txs);
      return txs.map((tx, i) => applySignature(tx, signed[i]));
    },
    async signAndSendTransaction(tx, options) {
      await solConnect();
      const r = await rpc("sol", "signAndSendTransaction", { transaction: toB64(serializeTx(tx)), options });
      return { signature: r.txId, publicKey: solana.publicKey };
    },
    async signMessage(message) {
      await solConnect();
      const r = await rpc("sol", "signMessage", { message: toB64(message) });
      return { signature: toBytes(r.signature), publicKey: solana.publicKey };
    },
    on(event, fn) { solEvents.on(event, fn); return solana; },
    off(event, fn) { solEvents.off(event, fn); return solana; },
    removeListener(event, fn) { solEvents.off(event, fn); return solana; },
  };
  if (!window.solana) {
    Object.defineProperty(window, "solana", { value: solana, configurable: true, writable: true });
  }

  const SOL_FEATURES = ["solana:signAndSendTransaction", "solana:signTransaction", "solana:signMessage"];
  const stdEvents = emitter();
  let stdAccounts = [];
  const setStdAccounts = (next) => { stdAccounts = next; stdEvents.emit("change", { accounts: next }); };
  const wallet = {
    version: "1.0.0",
    name: "Genesis",
    icon: ICON,
    chains: ["solana:mainnet", "solana:devnet", "solana:testnet"],
    get accounts() { return stdAccounts; },
    features: {
      "standard:connect": {
        version: "1.0.0",
        async connect() {
          const a = await solConnect();
          setStdAccounts([Object.freeze({ address: a.address, publicKey: a.publicKey, chains: [a.chain], features: SOL_FEATURES })]);
          return { accounts: stdAccounts };
        },
      },
      "standard:disconnect": { version: "1.0.0", async disconnect() { setStdAccounts([]); } },
      "standard:events": {
        version: "1.0.0",
        on(event, fn) { stdEvents.on(event, fn); return () => stdEvents.off(event, fn); },
      },
      "solana:signTransaction": {
        version: "1.0.0",
        supportedTransactionVersions: ["legacy", 0],
        async signTransaction(...inputs) {
          const signed = await signTxs(inputs.map((i) => i.transaction));
          return signed.map((s) => ({ signedTransaction: toBytes(s.signedTransaction) }));
        },
      },
      "solana:signAndSendTransaction": {
        version: "1.0.0",
        supportedTransactionVersions: ["legacy", 0],
        async signAndSendTransaction(...inputs) {
          const out = [];
          for (const input of inputs) {
            const r = await rpc("sol", "signAndSendTransaction", { transaction: toB64(input.transaction), options: input.options });
            out.push({ signature: toBytes(r.transactionSignature) });
          }
          return out;
        },
      },
      "solana:signMessage": {
        version: "1.0.0",
        async signMessage(...inputs) {
          const out = [];
          for (const input of inputs) {
            const r = await rpc("sol", "signMessage", { message: toB64(input.message) });
            out.push({ signedMessage: input.message, signature: toBytes(r.signature) });
          }
          return out;
        },
      },
    },
  };
  const register = (api) => { try { api.register(wallet); } catch {} };
  try { window.dispatchEvent(new CustomEvent("wallet-standard:register-wallet", { detail: register })); } catch {}
  try { window.addEventListener("wallet-standard:app-ready", (event) => register(event.detail)); } catch {}
})();`;
}
