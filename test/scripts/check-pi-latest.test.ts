import { describe, expect, it } from "vitest";
import {
  collectPiLatestDriftErrors,
  collectPinnedPiDependencies,
} from "../../scripts/check-pi-latest.mjs";

const registryBaseUrl = "https://registry.test";

function fetchImplFor(versions: Record<string, string>) {
  return async (url: string) => {
    const name = url.slice(`${registryBaseUrl}/`.length, -"/latest".length);
    const version = versions[name];
    if (!version) {
      return { ok: false, status: 404, statusText: "Not Found" };
    }
    return { ok: true, json: async () => ({ version }) };
  };
}

describe("scripts/check-pi-latest", () => {
  it("collects only exact-pinned pi dependencies, sorted by name", () => {
    expect(
      collectPinnedPiDependencies({
        dependencies: {
          "@earendil-works/pi-tui": "0.80.2",
          "@earendil-works/pi-ai": "0.80.2",
          "@earendil-works/pi-coding-agent": "latest",
          "@earendil-works/pi-agent-core": "^0.80.2",
          zod: "3.25.0",
        },
        devDependencies: { "@earendil-works/pi-dev": "1.0.0-beta.3" },
      }),
    ).toEqual([
      { name: "@earendil-works/pi-ai", section: "dependencies", spec: "0.80.2" },
      { name: "@earendil-works/pi-dev", section: "devDependencies", spec: "1.0.0-beta.3" },
      { name: "@earendil-works/pi-tui", section: "dependencies", spec: "0.80.2" },
    ]);
  });

  it("reports drift when a pin trails the npm latest version", async () => {
    const errors = await collectPiLatestDriftErrors({
      pinned: [
        { name: "@earendil-works/pi-ai", section: "dependencies", spec: "0.80.2" },
        { name: "@earendil-works/pi-tui", section: "dependencies", spec: "0.81.1" },
      ],
      fetchImpl: fetchImplFor({
        "@earendil-works/pi-ai": "0.81.1",
        "@earendil-works/pi-tui": "0.81.1",
      }),
      registryBaseUrl,
    });

    expect(errors).toEqual([
      "@earendil-works/pi-ai is pinned to 0.80.2 in dependencies but npm latest is 0.81.1",
    ]);
  });

  it("passes when every pin already matches npm latest", async () => {
    expect(
      await collectPiLatestDriftErrors({
        pinned: [{ name: "@earendil-works/pi-ai", section: "dependencies", spec: "0.81.1" }],
        fetchImpl: fetchImplFor({ "@earendil-works/pi-ai": "0.81.1" }),
        registryBaseUrl,
      }),
    ).toEqual([]);
  });

  it("surfaces registry failures instead of silently passing the release gate", async () => {
    await expect(
      collectPiLatestDriftErrors({
        pinned: [{ name: "@earendil-works/pi-missing", section: "dependencies", spec: "0.80.2" }],
        fetchImpl: fetchImplFor({}),
        registryBaseUrl,
      }),
    ).rejects.toThrow("registry lookup for '@earendil-works/pi-missing' failed (404 Not Found)");
  });
});
