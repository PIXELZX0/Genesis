import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const callGateway = vi.fn();
const runMessageAction = vi.fn();

vi.mock("../../gateway/call.js", () => ({
  callGateway: (...args: unknown[]) => callGateway(...args),
}));
vi.mock("../../infra/outbound/message-action-runner.js", () => ({
  runMessageAction: (...args: unknown[]) => runMessageAction(...args),
}));

const { baseCommandTestConfig, buildCommandTestParams } =
  await import("./commands.test-harness.js");
const { clearPendingSecretCapturesForTest, handleSecretCommand } =
  await import("./commands-secret.js");

function params(body: string) {
  return buildCommandTestParams(body, baseCommandTestConfig, {
    MessageSid: "msg-1",
    OriginatingTo: "chat-1",
  });
}

beforeEach(() => {
  clearPendingSecretCapturesForTest();
  callGateway.mockReset().mockResolvedValue({});
  runMessageAction.mockReset().mockResolvedValue({});
});

afterEach(() => {
  clearPendingSecretCapturesForTest();
});

describe("handleSecretCommand", () => {
  it("ignores unrelated messages when no capture is armed", async () => {
    expect(await handleSecretCommand(params("hello there"), true)).toBeNull();
  });

  it("rejects an invalid secret name", async () => {
    const result = await handleSecretCommand(params("/secret lower_case"), true);
    expect(result?.reply?.text).toContain("not a valid secret name");
    expect(callGateway).not.toHaveBeenCalled();
  });

  it("arms a capture and consumes the next message as the value", async () => {
    const armed = await handleSecretCommand(params("/secret STRIPE_API_KEY"), true);
    expect(armed?.shouldContinue).toBe(false);
    expect(armed?.reply?.text).toContain("STRIPE_API_KEY");
    expect(callGateway).not.toHaveBeenCalled();

    const captured = await handleSecretCommand(params("sk-live-abcdef123456"), true);
    expect(captured?.shouldContinue).toBe(false);
    expect(captured?.reply?.text).toContain("Stored STRIPE_API_KEY");
    // The value must never be echoed back into the conversation.
    expect(captured?.reply?.text).not.toContain("sk-live-abcdef123456");

    expect(callGateway).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "secret.resolve",
        params: { id: "STRIPE_API_KEY", action: "provide", value: "sk-live-abcdef123456" },
      }),
    );
    expect(runMessageAction).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "delete",
        params: expect.objectContaining({ messageId: "msg-1" }),
      }),
    );
  });

  it("disarms after one capture", async () => {
    await handleSecretCommand(params("/secret STRIPE_API_KEY"), true);
    await handleSecretCommand(params("sk-live-abcdef123456"), true);
    expect(await handleSecretCommand(params("a later normal message"), true)).toBeNull();
  });

  it("cancels without capturing", async () => {
    const result = await handleSecretCommand(params("/secret STRIPE_API_KEY cancel"), true);
    expect(result?.reply?.text).toContain("Declined STRIPE_API_KEY");
    expect(callGateway).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "secret.resolve",
        params: { id: "STRIPE_API_KEY", action: "cancel" },
      }),
    );
    expect(await handleSecretCommand(params("a later normal message"), true)).toBeNull();
  });

  it("does nothing when text commands are disabled", async () => {
    expect(await handleSecretCommand(params("/secret STRIPE_API_KEY"), false)).toBeNull();
  });
});
