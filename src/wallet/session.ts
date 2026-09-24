import { assertValidWalletMnemonic } from "./chains.js";
import { decryptWalletPayload, readWalletKeystore } from "./keystore.js";

export const WALLET_SESSION_DEFAULT_TTL_MS = 15 * 60 * 1000;
export const WALLET_SESSION_MAX_TTL_MS = 24 * 60 * 60 * 1000;

export type WalletSessionStatus = {
  unlocked: boolean;
  expiresAt?: number;
};

type WalletSessionState = {
  current?: { mnemonic: string; expiresAt: number };
};

// Live mutable state: direct globalThis lookup so split runtime chunks
// (gateway handlers, plugin-sdk facade, agent tools) share one unlock session.
const WALLET_SESSION_KEY = Symbol.for("genesis.wallet.session");

function sessionState(): WalletSessionState {
  const store = globalThis as Record<PropertyKey, unknown>;
  let state = store[WALLET_SESSION_KEY] as WalletSessionState | undefined;
  if (!state) {
    state = {};
    store[WALLET_SESSION_KEY] = state;
  }
  return state;
}

function activeSession(now = Date.now()) {
  const state = sessionState();
  if (state.current && state.current.expiresAt <= now) {
    state.current = undefined;
  }
  return state.current;
}

export async function unlockWalletSession(params: {
  passphrase: string;
  ttlMs?: number;
  env?: NodeJS.ProcessEnv;
}): Promise<WalletSessionStatus> {
  const ttlMs = params.ttlMs ?? WALLET_SESSION_DEFAULT_TTL_MS;
  if (!Number.isFinite(ttlMs) || ttlMs <= 0 || ttlMs > WALLET_SESSION_MAX_TTL_MS) {
    throw new Error(`Wallet unlock TTL must be between 1ms and ${WALLET_SESSION_MAX_TTL_MS}ms.`);
  }
  const keystore = await readWalletKeystore(params.env);
  if (!keystore) {
    throw new Error("Wallet keystore not found. Run genesis wallet init or import first.");
  }
  const payload = await decryptWalletPayload(keystore, params.passphrase);
  const mnemonic = assertValidWalletMnemonic(payload.mnemonic);
  const expiresAt = Date.now() + ttlMs;
  sessionState().current = { mnemonic, expiresAt };
  return { unlocked: true, expiresAt };
}

export function lockWalletSession(): WalletSessionStatus {
  sessionState().current = undefined;
  return { unlocked: false };
}

export function getWalletSessionStatus(): WalletSessionStatus {
  const session = activeSession();
  return session ? { unlocked: true, expiresAt: session.expiresAt } : { unlocked: false };
}

export function requireWalletSessionMnemonic(): string {
  const session = activeSession();
  if (!session) {
    throw new Error("Wallet is locked. Ask the user to run `genesis wallet unlock`.");
  }
  return session.mnemonic;
}
