import { describe, expect, it } from "vitest";
import { CONFIG_PRESETS, detectActivePreset } from "./config-presets.ts";

describe("detectActivePreset", () => {
  it("matches every preset by its full patch", () => {
    for (const preset of CONFIG_PRESETS) {
      expect(detectActivePreset(preset.patch)).toBe(preset.id);
    }
  });

  it("treats unset defaults as built-in runtime defaults, not a preset", () => {
    expect(detectActivePreset({})).toBeNull();
  });

  it("does not match when only the size limits line up", () => {
    const config = {
      agents: {
        defaults: {
          bootstrapMaxChars: 20_000,
          bootstrapTotalMaxChars: 150_000,
          contextInjection: "continuation-skip",
        },
      },
    };
    expect(detectActivePreset(config)).toBeNull();
  });
});
