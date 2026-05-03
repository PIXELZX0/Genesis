import { describe, expect, it } from "vitest";
import {
  COMPATIBLE_MANIFEST_KEYS,
  LEGACY_MANIFEST_KEYS,
  MANIFEST_KEY,
  PROJECT_NAME,
} from "./legacy-names.js";

describe("compat/legacy-names", () => {
  it("keeps the current manifest key primary while exposing legacy fallbacks", () => {
    expect(PROJECT_NAME).toBe("genesis");
    expect(MANIFEST_KEY).toBe("genesis");
    expect(LEGACY_MANIFEST_KEYS).toEqual(["clawdbot"]);
    expect(COMPATIBLE_MANIFEST_KEYS).toEqual(["genesis", "openclaw", "clawdbot"]);
  });
});
