import { describe, expect, it } from "vitest";
import {
  canSubmitAuthProfileDialog,
  openAuthProfileDialog,
  projectAuthStatusToProviders,
} from "./auth-profiles.ts";

describe("auth profile dialog", () => {
  it("requires provider, profile id and key to add", () => {
    const dialog = openAuthProfileDialog("add", { provider: "anthropic", profileId: "anthropic:" });
    expect(canSubmitAuthProfileDialog(dialog)).toBe(false);
    expect(canSubmitAuthProfileDialog({ ...dialog, value: "sk-test" })).toBe(true);
  });

  it("accepts blank (round-robin) or integer priorities only", () => {
    const dialog = openAuthProfileDialog("priority", { profileId: "anthropic:work" });
    expect(canSubmitAuthProfileDialog(dialog)).toBe(true);
    expect(canSubmitAuthProfileDialog({ ...dialog, priority: "3" })).toBe(true);
    expect(canSubmitAuthProfileDialog({ ...dialog, priority: "1.5" })).toBe(false);
  });

  it("projects auth status into view rows", () => {
    const providers = projectAuthStatusToProviders({
      ts: 1,
      providers: [
        {
          provider: "anthropic",
          displayName: "Anthropic",
          status: "ok",
          profiles: [
            { profileId: "anthropic:work", type: "api_key", status: "static", priority: 2 },
            { profileId: "anthropic:old", type: "oauth", status: "missing" },
          ],
        },
      ],
    });
    expect(providers[0]?.profiles.map((row) => [row.profileId, row.isSet, row.priority])).toEqual([
      ["anthropic:work", true, 2],
      ["anthropic:old", false, undefined],
    ]);
  });
});
