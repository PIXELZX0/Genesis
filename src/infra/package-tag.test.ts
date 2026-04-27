import { describe, expect, it } from "vitest";
import { normalizePackageTagInput } from "./package-tag.js";

describe("normalizePackageTagInput", () => {
  const packageNames = ["genesis", "@genesis/plugin"] as const;

  it.each([
    { input: undefined, expected: null },
    { input: "   ", expected: null },
    { input: "genesis@beta", expected: "beta" },
    { input: "@genesis/plugin@2026.2.24", expected: "2026.2.24" },
    { input: "genesis@   ", expected: null },
    { input: "genesis", expected: null },
    { input: " @genesis/plugin ", expected: null },
    { input: " latest ", expected: "latest" },
    { input: "@other/plugin@beta", expected: "@other/plugin@beta" },
    { input: "genesiser@beta", expected: "genesiser@beta" },
  ] satisfies ReadonlyArray<{ input: string | undefined; expected: string | null }>)(
    "normalizes %j",
    ({ input, expected }) => {
      expect(normalizePackageTagInput(input, packageNames)).toBe(expected);
    },
  );
});
