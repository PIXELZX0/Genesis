import { randomBytes, scrypt } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { resolveStateDir } from "../config/paths.js";
import { PRIVATE_SECRET_DIR_MODE, writePrivateSecretFileAtomic } from "../infra/secret-file.js";
import type { WalletPrivatePayload, WalletPublicAccount } from "./types.js";

const scryptAsync = promisify(scrypt) as (
  password: string | Buffer,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem?: number },
) => Promise<Buffer>;

const KEYSTORE_VERSION = 1 as const;
const KEY_LENGTH = 32;
const SCRYPT_PARAMS = { N: 32768, r: 8, p: 1, maxmem: 128 * 1024 * 1024 };

export type WalletKeystoreFile = {
  version: typeof KEYSTORE_VERSION;
  public: {
    primaryAccount?: string;
    accounts: WalletPublicAccount[];
    updatedAt: string;
  };
  crypto: {
    kdf: "scrypt";
    salt: string;
    n: number;
    r: number;
    p: number;
    maxmem?: number;
    keyLength: number;
    cipher: "aes-256-gcm";
    nonce: string;
    tag: string;
    ciphertext: string;
  };
};

export type WalletKeystorePaths = {
  rootDir: string;
  filePath: string;
};

export function resolveWalletKeystorePaths(
  env: NodeJS.ProcessEnv = process.env,
): WalletKeystorePaths {
  const stateDir = resolveStateDir(env);
  const rootDir = path.join(stateDir, "credentials");
  return {
    rootDir,
    filePath: path.join(rootDir, "wallets.json"),
  };
}

function encodeBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

function decodeBase64Url(value: string): Buffer {
  return Buffer.from(value, "base64url");
}

async function deriveKey(
  passphrase: string,
  salt: Buffer,
  params = SCRYPT_PARAMS,
): Promise<Buffer> {
  if (!passphrase.trim()) {
    throw new Error("Wallet passphrase is required.");
  }
  return scryptAsync(passphrase, salt, KEY_LENGTH, params);
}

export async function encryptWalletPayload(params: {
  payload: WalletPrivatePayload;
  publicAccounts: WalletPublicAccount[];
  primaryAccount?: string;
  passphrase: string;
}): Promise<WalletKeystoreFile> {
  const salt = randomBytes(16);
  const nonce = randomBytes(12);
  const key = await deriveKey(params.passphrase, salt);
  const { createCipheriv } = await import("node:crypto");
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const plaintext = Buffer.from(JSON.stringify(params.payload), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    version: KEYSTORE_VERSION,
    public: {
      primaryAccount: params.primaryAccount,
      accounts: params.publicAccounts,
      updatedAt: new Date().toISOString(),
    },
    crypto: {
      kdf: "scrypt",
      salt: encodeBase64Url(salt),
      n: SCRYPT_PARAMS.N,
      r: SCRYPT_PARAMS.r,
      p: SCRYPT_PARAMS.p,
      maxmem: SCRYPT_PARAMS.maxmem,
      keyLength: KEY_LENGTH,
      cipher: "aes-256-gcm",
      nonce: encodeBase64Url(nonce),
      tag: encodeBase64Url(tag),
      ciphertext: encodeBase64Url(ciphertext),
    },
  };
}

export async function decryptWalletPayload(
  file: WalletKeystoreFile,
  passphrase: string,
): Promise<WalletPrivatePayload> {
  if (file.version !== KEYSTORE_VERSION || file.crypto.cipher !== "aes-256-gcm") {
    throw new Error("Unsupported wallet keystore version.");
  }
  const salt = decodeBase64Url(file.crypto.salt);
  const nonce = decodeBase64Url(file.crypto.nonce);
  const tag = decodeBase64Url(file.crypto.tag);
  const ciphertext = decodeBase64Url(file.crypto.ciphertext);
  const key = await deriveKey(passphrase, salt, {
    N: file.crypto.n,
    r: file.crypto.r,
    p: file.crypto.p,
    maxmem: file.crypto.maxmem ?? SCRYPT_PARAMS.maxmem,
  });
  const { createDecipheriv } = await import("node:crypto");
  const decipher = createDecipheriv("aes-256-gcm", key, nonce);
  decipher.setAuthTag(tag);
  try {
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return JSON.parse(plaintext.toString("utf8")) as WalletPrivatePayload;
  } catch (error) {
    throw new Error("Unable to decrypt wallet keystore. Check the passphrase.", {
      cause: error,
    });
  }
}

export async function readWalletKeystore(
  env: NodeJS.ProcessEnv = process.env,
): Promise<WalletKeystoreFile | null> {
  const { filePath } = resolveWalletKeystorePaths(env);
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as WalletKeystoreFile;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

export async function writeWalletKeystore(
  file: WalletKeystoreFile,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  const { rootDir, filePath } = resolveWalletKeystorePaths(env);
  await fs.mkdir(rootDir, { recursive: true, mode: PRIVATE_SECRET_DIR_MODE });
  await writePrivateSecretFileAtomic({
    rootDir,
    filePath,
    content: `${JSON.stringify(file, null, 2)}\n`,
  });
  return filePath;
}
