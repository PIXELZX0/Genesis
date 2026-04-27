import { describe, expect, it } from "vitest";
import { derivePublicAccounts } from "./chains.js";

const MNEMONIC =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

describe("wallet chain derivation", () => {
  it("derives deterministic public addresses for local keystore chains", async () => {
    const accounts = await derivePublicAccounts({ mnemonic: MNEMONIC });
    const byChain = Object.fromEntries(accounts.map((account) => [account.chain, account.address]));

    expect(byChain.btc).toBe("bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu");
    expect(byChain.evm).toBe("0x9858EfFD232B4033E47d90003D41EC34EcaEda94");
    expect(byChain.sol).toBe("HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk");
    expect(byChain.trx).toBe("TUEZSdKsoDHQMeZwihtdoBiN46zxhGWYdH");
  });
});
