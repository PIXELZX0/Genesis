import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SecretRequestPayload } from "../../infra/secret-requests.js";
import { getStoredSecretValue } from "../../secrets/stored/store.js";
import { ExecApprovalManager } from "../exec-approval-manager.js";
import { createSecretRequestHandlers } from "./secret-requests.js";
import type { GatewayRequestHandlerOptions } from "./types.js";

let tmpDir: string;
let previousOauthDir: string | undefined;
let manager: ExecApprovalManager<SecretRequestPayload>;

function createMockOptions(
  method: string,
  params: Record<string, unknown>,
): GatewayRequestHandlerOptions {
  return {
    req: { method, params, id: "req-1" },
    params,
    client: { connect: { client: { id: "test-client", displayName: "Test Client" } } },
    isWebchatConnect: () => false,
    respond: vi.fn(),
    context: {
      broadcast: vi.fn(),
      logGateway: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
      hasExecApprovalClients: () => true,
    },
  } as unknown as GatewayRequestHandlerOptions;
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "genesis-secret-requests-"));
  previousOauthDir = process.env.GENESIS_OAUTH_DIR;
  process.env.GENESIS_OAUTH_DIR = tmpDir;
  manager = new ExecApprovalManager<SecretRequestPayload>();
});

afterEach(async () => {
  vi.restoreAllMocks();
  if (previousOauthDir === undefined) {
    delete process.env.GENESIS_OAUTH_DIR;
  } else {
    process.env.GENESIS_OAUTH_DIR = previousOauthDir;
  }
  await fs.rm(tmpDir, { recursive: true, force: true });
});

async function registerRequest(name = "STRIPE_API_KEY") {
  const handlers = createSecretRequestHandlers(manager);
  const opts = createMockOptions("secret.request", {
    name,
    description: "Billing sync",
    twoPhase: true,
  });
  // Two-phase: the "accepted" response lands while the request stays pending.
  const pending = handlers["secret.request"](opts);
  await vi.waitFor(() => expect(opts.respond).toHaveBeenCalled());
  const accepted = (opts.respond as ReturnType<typeof vi.fn>).mock.calls[0][1] as {
    status: string;
    id: string;
  };
  return { handlers, opts, pending, accepted };
}

describe("createSecretRequestHandlers", () => {
  it("exposes the three secret request methods", () => {
    const handlers = createSecretRequestHandlers(manager);
    expect(Object.keys(handlers).toSorted()).toEqual([
      "secret.request",
      "secret.resolve",
      "secret.waitRequest",
    ]);
  });

  it("rejects invalid params", async () => {
    const handlers = createSecretRequestHandlers(manager);
    const opts = createMockOptions("secret.request", { name: "lowercase", description: "x" });
    await handlers["secret.request"](opts);
    expect(opts.respond).toHaveBeenCalledWith(false, undefined, expect.anything());
  });

  it("accepts a two-phase request without leaking a value", async () => {
    const { accepted, opts, handlers } = await registerRequest();
    expect(accepted.status).toBe("accepted");
    expect(accepted.id.startsWith("secret:")).toBe(true);
    expect(opts.context.broadcast).toHaveBeenCalledWith(
      "secret.requested",
      expect.objectContaining({ request: expect.objectContaining({ name: "STRIPE_API_KEY" }) }),
      expect.anything(),
    );
    // Cleanly end the pending request so the test does not leave a timer armed.
    manager.expire(accepted.id);
    void handlers;
  });

  it("stores the value on provide and returns only a reference", async () => {
    const { handlers, accepted } = await registerRequest();

    const waitOpts = createMockOptions("secret.waitRequest", { id: accepted.id });
    const waiting = handlers["secret.waitRequest"](waitOpts);

    const resolveOpts = createMockOptions("secret.resolve", {
      id: accepted.id,
      action: "provide",
      value: "sk-live-abcdef123456",
    });
    await handlers["secret.resolve"](resolveOpts);
    expect(resolveOpts.respond).toHaveBeenCalledWith(true, { ok: true }, undefined);

    await waiting;
    const waitResult = (waitOpts.respond as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(waitResult).toEqual({
      id: accepted.id,
      status: "provided",
      ref: { source: "file", provider: "stored", id: "/secrets/STRIPE_API_KEY/value" },
    });
    expect(JSON.stringify(waitResult)).not.toContain("sk-live-abcdef123456");

    const broadcastPayload = (resolveOpts.context.broadcast as ReturnType<typeof vi.fn>).mock.calls
      .map((call) => call[1])
      .at(-1);
    expect(JSON.stringify(broadcastPayload)).not.toContain("sk-live-abcdef123456");

    expect(getStoredSecretValue("STRIPE_API_KEY")).toBe("sk-live-abcdef123456");
  });

  it("resolves by secret name so chat clients need no request id", async () => {
    const { handlers, accepted } = await registerRequest("GITHUB_TOKEN");
    const resolveOpts = createMockOptions("secret.resolve", {
      id: "GITHUB_TOKEN",
      action: "provide",
      value: "ghp_abcdefghijklmnop",
    });
    await handlers["secret.resolve"](resolveOpts);
    expect(resolveOpts.respond).toHaveBeenCalledWith(true, { ok: true }, undefined);
    expect(manager.getSnapshot(accepted.id)?.decision).toBe("allow-once");
  });

  it("reports cancellation without storing anything", async () => {
    const { handlers, accepted } = await registerRequest("SLACK_TOKEN");
    const waitOpts = createMockOptions("secret.waitRequest", { id: accepted.id });
    const waiting = handlers["secret.waitRequest"](waitOpts);

    const resolveOpts = createMockOptions("secret.resolve", {
      id: accepted.id,
      action: "cancel",
    });
    await handlers["secret.resolve"](resolveOpts);
    await waiting;

    expect((waitOpts.respond as ReturnType<typeof vi.fn>).mock.calls[0][1]).toEqual({
      id: accepted.id,
      status: "cancelled",
      ref: null,
    });
    expect(getStoredSecretValue("SLACK_TOKEN")).toBeUndefined();
  });

  it("requires a value when providing", async () => {
    const { handlers, accepted } = await registerRequest("EMPTY_TOKEN");
    const resolveOpts = createMockOptions("secret.resolve", {
      id: accepted.id,
      action: "provide",
    });
    await handlers["secret.resolve"](resolveOpts);
    expect(resolveOpts.respond).toHaveBeenCalledWith(false, undefined, expect.anything());
    manager.expire(accepted.id);
  });
});
