declare module "ed25519-hd-key" {
  import type { Buffer } from "node:buffer";

  export function derivePath(
    path: string,
    seed: string,
  ): {
    key: Buffer;
    chainCode: Buffer;
  };

  export function getMasterKeyFromSeed(seed: string): {
    key: Buffer;
    chainCode: Buffer;
  };

  export function getPublicKey(privateKey: Buffer, withZeroByte?: boolean): Buffer;
}
