import { describe, expect, it, vi } from "vitest";

const ensureMatrixCryptoRuntime = vi.hoisted(() => vi.fn<() => Promise<void>>());

vi.mock("../deps.js", () => ({ ensureMatrixCryptoRuntime }));
vi.mock("./crypto-node.runtime.js", () => ({
  Attachment: {
    encrypt: () => ({
      mediaEncryptionInfo: JSON.stringify({ key: { k: "k" }, iv: "iv", hashes: {}, v: "v2" }),
      encryptedData: new Uint8Array([1, 2, 3]),
    }),
  },
  EncryptedAttachment: class {},
}));

describe("createMatrixCryptoFacade native runtime bootstrap", () => {
  it("bootstraps the native runtime before loading it and retries after a failed bootstrap", async () => {
    const { createMatrixCryptoFacade } = await import("./crypto-facade.js");
    const facade = createMatrixCryptoFacade({
      client: { getRoom: () => null, getCrypto: () => undefined, getUserId: () => null },
      verificationManager: {} as never,
      recoveryKeyStore: {} as never,
      getRoomStateEvent: async () => ({}),
      downloadContent: async () => Buffer.alloc(0),
    });

    ensureMatrixCryptoRuntime.mockRejectedValueOnce(new Error("bootstrap failed"));
    await expect(facade.encryptMedia(Buffer.from("a"))).rejects.toThrow("bootstrap failed");

    ensureMatrixCryptoRuntime.mockResolvedValueOnce(undefined);
    const result = await facade.encryptMedia(Buffer.from("a"));

    expect(result.buffer).toEqual(Buffer.from([1, 2, 3]));
    expect(ensureMatrixCryptoRuntime).toHaveBeenCalledTimes(2);

    await facade.encryptMedia(Buffer.from("b"));
    expect(ensureMatrixCryptoRuntime).toHaveBeenCalledTimes(2);
  });
});
