import { describe, expect, it } from "vitest";
import { formatAtomicAmount, parseDecimalAmount } from "./amounts.js";

describe("wallet amounts", () => {
  it("parses and formats decimal native amounts", () => {
    expect(parseDecimalAmount("1.25", 8)).toBe(125000000n);
    expect(formatAtomicAmount(125000000n, 8)).toBe("1.25");
    expect(formatAtomicAmount(1n, 12)).toBe("0.000000000001");
  });

  it("rejects precision that exceeds the asset decimals", () => {
    expect(() => parseDecimalAmount("0.000000001", 8)).toThrow(/more than 8/);
  });
});
