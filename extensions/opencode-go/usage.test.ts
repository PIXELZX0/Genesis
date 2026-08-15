import { describe, expect, it, vi } from "vitest";
import { fetchOpencodeGoUsage } from "./usage.js";

function mockFetch(status: number, body: unknown) {
  const fn = vi.fn(
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
  );
  return fn as unknown as typeof fetch & typeof fn;
}

describe("fetchOpencodeGoUsage", () => {
  it("maps rolling/weekly/monthly windows with reset times", async () => {
    const now = Date.UTC(2026, 0, 8, 12, 0, 0);
    const fetchFn = mockFetch(200, {
      useBalance: false,
      rollingUsage: { status: "ok", usagePercent: 65, resetInSec: 2520 },
      weeklyUsage: { status: "ok", usagePercent: 30, resetInSec: 259200 },
      monthlyUsage: { status: "rate-limited", usagePercent: 100, resetInSec: 1728000 },
    });

    const result = await fetchOpencodeGoUsage("key", 5000, fetchFn, now);

    expect(fetchFn).toHaveBeenCalledWith(
      "https://opencode.ai/zen/go/v1/usage",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer key" }),
      }),
    );
    expect(result.provider).toBe("opencode-go");
    expect(result.displayName).toBe("OpenCode Go");
    expect(result.windows).toEqual([
      { label: "Rolling", usedPercent: 65, resetAt: now + 2520 * 1000 },
      { label: "Weekly", usedPercent: 30, resetAt: now + 259200 * 1000 },
      { label: "Monthly", usedPercent: 100, resetAt: now + 1728000 * 1000 },
    ]);
  });

  it("skips windows the endpoint omits", async () => {
    const fetchFn = mockFetch(200, {
      rollingUsage: { status: "ok", usagePercent: 0 },
    });

    const result = await fetchOpencodeGoUsage("key", 5000, fetchFn, 0);
    expect(result.windows).toEqual([{ label: "Rolling", usedPercent: 0 }]);
  });

  it("surfaces endpoint error messages", async () => {
    const fetchFn = mockFetch(403, {
      type: "error",
      error: { type: "EntitlementError", message: "OpenCode Go subscription required." },
    });

    const result = await fetchOpencodeGoUsage("key", 5000, fetchFn, 0);
    expect(result.error).toBe("HTTP 403: OpenCode Go subscription required.");
    expect(result.windows).toHaveLength(0);
  });

  it("reports expired tokens for unauthorized responses", async () => {
    const fetchFn = mockFetch(401, { error: { message: "Unauthorized" } });

    const result = await fetchOpencodeGoUsage("key", 5000, fetchFn, 0);
    expect(result.error).toBe("Token expired");
  });
});
