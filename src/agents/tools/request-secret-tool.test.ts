import { beforeEach, describe, expect, it, vi } from "vitest";

const callGatewayTool = vi.fn();
vi.mock("./gateway.js", () => ({
  callGatewayTool: (...args: unknown[]) => callGatewayTool(...args),
}));

const { createRequestSecretTool } = await import("./request-secret-tool.js");

const REF = { source: "file", provider: "stored", id: "/secrets/STRIPE_API_KEY/value" };

beforeEach(() => {
  callGatewayTool.mockReset();
});

async function run(args: Record<string, unknown>) {
  return await createRequestSecretTool().execute("call-1", args, undefined, undefined);
}

function firstText(result: Awaited<ReturnType<typeof run>>): string {
  const entry = result.content[0];
  return entry && "text" in entry ? entry.text : "";
}

describe("request_secret tool", () => {
  it("rejects a non-UPPER_SNAKE_CASE name before calling the gateway", async () => {
    await expect(run({ name: "lower", description: "why" })).rejects.toThrow(/UPPER_SNAKE_CASE/);
    expect(callGatewayTool).not.toHaveBeenCalled();
  });

  it("registers then waits, and returns a reference rather than a value", async () => {
    callGatewayTool
      .mockResolvedValueOnce({ status: "accepted", id: "secret:abc" })
      .mockResolvedValueOnce({ status: "provided", ref: REF });

    const result = await run({ name: "STRIPE_API_KEY", description: "Billing sync" });
    expect(callGatewayTool.mock.calls[0][0]).toBe("secret.request");
    expect(callGatewayTool.mock.calls[0][2]).toMatchObject({
      name: "STRIPE_API_KEY",
      twoPhase: true,
    });
    expect(callGatewayTool.mock.calls[1][0]).toBe("secret.waitRequest");
    expect(callGatewayTool.mock.calls[1][2]).toEqual({ id: "secret:abc" });

    const text = firstText(result);
    expect(text).toContain("stored on the gateway");
    expect(text).toContain("secretEnv");
    expect(result.details).toMatchObject({ status: "provided", name: "STRIPE_API_KEY", ref: REF });
  });

  it("reports a declined request without a reference", async () => {
    callGatewayTool
      .mockResolvedValueOnce({ status: "accepted", id: "secret:abc" })
      .mockResolvedValueOnce({ status: "cancelled", ref: null });

    const result = await run({ name: "STRIPE_API_KEY", description: "Billing sync" });
    expect(firstText(result)).toContain("declined the request");
    expect(result.details).toMatchObject({ status: "cancelled" });
    expect(result.details).not.toHaveProperty("ref");
  });

  it("treats a registration with no id as expired", async () => {
    callGatewayTool.mockResolvedValueOnce({});
    const result = await run({ name: "STRIPE_API_KEY", description: "Billing sync" });
    expect(callGatewayTool).toHaveBeenCalledTimes(1);
    expect(result.details).toMatchObject({ status: "expired" });
  });
});
