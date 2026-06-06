import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GatewayRequestHandlerOptions } from "./types.js";

const mocks = vi.hoisted(() => ({
  resolveGenesisAgentDir: vi.fn(() => "/tmp/agent"),
  upsertAuthProfileWithLock: vi.fn(),
  removeAuthProfileWithLock: vi.fn(),
  updateAuthProfileMetadataWithLock: vi.fn(),
  setAuthProfileOrder: vi.fn(),
  loadConfig: vi.fn(() => ({})),
  invalidateModelAuthStatusCache: vi.fn(),
}));

vi.mock("../../agents/agent-paths.js", () => ({
  resolveGenesisAgentDir: mocks.resolveGenesisAgentDir,
}));

vi.mock("../../agents/auth-profiles/profiles.js", () => ({
  upsertAuthProfileWithLock: mocks.upsertAuthProfileWithLock,
  removeAuthProfileWithLock: mocks.removeAuthProfileWithLock,
  updateAuthProfileMetadataWithLock: mocks.updateAuthProfileMetadataWithLock,
  setAuthProfileOrder: mocks.setAuthProfileOrder,
}));

vi.mock("../../config/config.js", () => ({
  loadConfig: mocks.loadConfig,
}));

vi.mock("./models-auth-status.js", () => ({
  invalidateModelAuthStatusCache: mocks.invalidateModelAuthStatusCache,
}));

import { modelsAuthProfileMutationHandlers } from "./models-auth-profile-mutations.js";

function createOptions(
  method: string,
  params: Record<string, unknown> = {},
): GatewayRequestHandlerOptions & { respond: ReturnType<typeof vi.fn> } {
  const respond = vi.fn();
  return {
    req: { type: "req", id: "req-1", method, params },
    params,
    client: null,
    isWebchatConnect: () => false,
    respond,
    context: {} as unknown,
  } as unknown as GatewayRequestHandlerOptions & { respond: ReturnType<typeof vi.fn> };
}

function lastResponse(respond: ReturnType<typeof vi.fn>): {
  ok: boolean;
  error?: { message?: string };
} {
  expect(respond).toHaveBeenCalledTimes(1);
  const call = respond.mock.calls[0] as unknown[];
  return { ok: call[0] as boolean, error: call[2] as { message?: string } | undefined };
}

describe("models.authProfileAdd", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.upsertAuthProfileWithLock.mockResolvedValue({
      version: 1,
      profiles: {
        "anthropic:work": {
          type: "api_key",
          provider: "anthropic",
          key: "sk-test",
          displayName: "Work",
          priority: 100,
        },
      },
    });
  });

  it("writes a new profile with name and priority", async () => {
    const opts = createOptions("models.authProfileAdd", {
      profileId: "anthropic:work",
      provider: "anthropic",
      mode: "api_key",
      value: "sk-test",
      displayName: "Work",
      priority: 100,
    });
    const handler = modelsAuthProfileMutationHandlers["models.authProfileAdd"];
    if (!handler) {
      throw new Error("handler missing");
    }
    await handler(opts);
    const res = lastResponse(opts.respond);
    expect(res.ok).toBe(true);
    expect(mocks.upsertAuthProfileWithLock).toHaveBeenCalledWith({
      profileId: "anthropic:work",
      credential: expect.objectContaining({
        type: "api_key",
        provider: "anthropic",
        key: "sk-test",
        displayName: "Work",
        priority: 100,
      }),
      agentDir: "/tmp/agent",
    });
  });

  it("rejects missing provider", async () => {
    const opts = createOptions("models.authProfileAdd", {
      profileId: "anthropic:work",
      mode: "api_key",
      value: "sk-test",
    });
    const handler = modelsAuthProfileMutationHandlers["models.authProfileAdd"];
    if (!handler) {
      throw new Error("handler missing");
    }
    await handler(opts);
    const res = lastResponse(opts.respond);
    expect(res.ok).toBe(false);
  });

  it("rejects invalid mode", async () => {
    const opts = createOptions("models.authProfileAdd", {
      profileId: "anthropic:work",
      provider: "anthropic",
      mode: "weird",
      value: "sk-test",
    });
    const handler = modelsAuthProfileMutationHandlers["models.authProfileAdd"];
    if (!handler) {
      throw new Error("handler missing");
    }
    await handler(opts);
    const res = lastResponse(opts.respond);
    expect(res.ok).toBe(false);
  });

  it("rejects non-integer priority", async () => {
    const opts = createOptions("models.authProfileAdd", {
      profileId: "anthropic:work",
      provider: "anthropic",
      mode: "api_key",
      value: "sk-test",
      priority: 1.5,
    });
    const handler = modelsAuthProfileMutationHandlers["models.authProfileAdd"];
    if (!handler) {
      throw new Error("handler missing");
    }
    await handler(opts);
    const res = lastResponse(opts.respond);
    expect(res.ok).toBe(false);
  });

  it("rejects too-long displayName", async () => {
    const opts = createOptions("models.authProfileAdd", {
      profileId: "anthropic:work",
      provider: "anthropic",
      mode: "api_key",
      value: "sk-test",
      displayName: "x".repeat(120),
    });
    const handler = modelsAuthProfileMutationHandlers["models.authProfileAdd"];
    if (!handler) {
      throw new Error("handler missing");
    }
    await handler(opts);
    const res = lastResponse(opts.respond);
    expect(res.ok).toBe(false);
  });

  it("returns lock-busy error when upsert returns null", async () => {
    mocks.upsertAuthProfileWithLock.mockResolvedValueOnce(null);
    const opts = createOptions("models.authProfileAdd", {
      profileId: "anthropic:work",
      provider: "anthropic",
      mode: "api_key",
      value: "sk-test",
    });
    const handler = modelsAuthProfileMutationHandlers["models.authProfileAdd"];
    if (!handler) {
      throw new Error("handler missing");
    }
    await handler(opts);
    const res = lastResponse(opts.respond);
    expect(res.ok).toBe(false);
    expect(res.error?.message).toMatch(/lock busy/);
  });
});

describe("models.authProfileRemove", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.removeAuthProfileWithLock.mockResolvedValue({
      version: 1,
      profiles: {},
    });
  });

  it("removes a profile", async () => {
    const opts = createOptions("models.authProfileRemove", { profileId: "anthropic:work" });
    const handler = modelsAuthProfileMutationHandlers["models.authProfileRemove"];
    if (!handler) {
      throw new Error("handler missing");
    }
    await handler(opts);
    const res = lastResponse(opts.respond);
    expect(res.ok).toBe(true);
    expect(mocks.removeAuthProfileWithLock).toHaveBeenCalledWith({
      profileId: "anthropic:work",
      agentDir: "/tmp/agent",
    });
  });

  it("rejects missing profileId", async () => {
    const opts = createOptions("models.authProfileRemove", {});
    const handler = modelsAuthProfileMutationHandlers["models.authProfileRemove"];
    if (!handler) {
      throw new Error("handler missing");
    }
    await handler(opts);
    const res = lastResponse(opts.respond);
    expect(res.ok).toBe(false);
  });
});

describe("models.authProfileRename", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateAuthProfileMetadataWithLock.mockResolvedValue({
      version: 1,
      profiles: {
        "anthropic:work": {
          type: "api_key",
          provider: "anthropic",
          key: "sk-test",
          displayName: "Work",
        },
      },
    });
  });

  it("renames a profile", async () => {
    const opts = createOptions("models.authProfileRename", {
      profileId: "anthropic:work",
      displayName: "Work",
    });
    const handler = modelsAuthProfileMutationHandlers["models.authProfileRename"];
    if (!handler) {
      throw new Error("handler missing");
    }
    await handler(opts);
    const res = lastResponse(opts.respond);
    expect(res.ok).toBe(true);
    expect(mocks.updateAuthProfileMetadataWithLock).toHaveBeenCalledWith({
      profileId: "anthropic:work",
      displayName: "Work",
      agentDir: "/tmp/agent",
    });
  });

  it("returns not-found when lock returns null", async () => {
    mocks.updateAuthProfileMetadataWithLock.mockResolvedValueOnce(null);
    const opts = createOptions("models.authProfileRename", {
      profileId: "missing",
      displayName: "X",
    });
    const handler = modelsAuthProfileMutationHandlers["models.authProfileRename"];
    if (!handler) {
      throw new Error("handler missing");
    }
    await handler(opts);
    const res = lastResponse(opts.respond);
    expect(res.ok).toBe(false);
  });

  it("rejects empty displayName", async () => {
    const opts = createOptions("models.authProfileRename", {
      profileId: "anthropic:work",
      displayName: "",
    });
    const handler = modelsAuthProfileMutationHandlers["models.authProfileRename"];
    if (!handler) {
      throw new Error("handler missing");
    }
    await handler(opts);
    const res = lastResponse(opts.respond);
    expect(res.ok).toBe(false);
  });
});

describe("models.authProfileSetPriority", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateAuthProfileMetadataWithLock.mockResolvedValue({
      version: 1,
      profiles: {
        "anthropic:work": {
          type: "api_key",
          provider: "anthropic",
          key: "sk-test",
          priority: 100,
        },
      },
    });
  });

  it("sets a priority", async () => {
    const opts = createOptions("models.authProfileSetPriority", {
      profileId: "anthropic:work",
      priority: 100,
    });
    const handler = modelsAuthProfileMutationHandlers["models.authProfileSetPriority"];
    if (!handler) {
      throw new Error("handler missing");
    }
    await handler(opts);
    const res = lastResponse(opts.respond);
    expect(res.ok).toBe(true);
    expect(mocks.updateAuthProfileMetadataWithLock).toHaveBeenCalledWith({
      profileId: "anthropic:work",
      priority: 100,
      agentDir: "/tmp/agent",
    });
  });

  it("clears a priority via null", async () => {
    const opts = createOptions("models.authProfileSetPriority", {
      profileId: "anthropic:work",
      priority: null,
    });
    const handler = modelsAuthProfileMutationHandlers["models.authProfileSetPriority"];
    if (!handler) {
      throw new Error("handler missing");
    }
    await handler(opts);
    const res = lastResponse(opts.respond);
    expect(res.ok).toBe(true);
    expect(mocks.updateAuthProfileMetadataWithLock).toHaveBeenCalledWith({
      profileId: "anthropic:work",
      priority: null,
      agentDir: "/tmp/agent",
    });
  });

  it("rejects non-integer priority", async () => {
    const opts = createOptions("models.authProfileSetPriority", {
      profileId: "anthropic:work",
      priority: 1.5,
    });
    const handler = modelsAuthProfileMutationHandlers["models.authProfileSetPriority"];
    if (!handler) {
      throw new Error("handler missing");
    }
    await handler(opts);
    const res = lastResponse(opts.respond);
    expect(res.ok).toBe(false);
  });
});

describe("models.authProfileReorder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.setAuthProfileOrder.mockResolvedValue({
      version: 1,
      profiles: {},
      order: { anthropic: ["anthropic:work", "anthropic:default"] },
    });
  });

  it("reorders profiles for a provider", async () => {
    const opts = createOptions("models.authProfileReorder", {
      provider: "anthropic",
      profileIds: ["anthropic:work", "anthropic:default"],
    });
    const handler = modelsAuthProfileMutationHandlers["models.authProfileReorder"];
    if (!handler) {
      throw new Error("handler missing");
    }
    await handler(opts);
    const res = lastResponse(opts.respond);
    expect(res.ok).toBe(true);
  });

  it("rejects non-string profileIds", async () => {
    const opts = createOptions("models.authProfileReorder", {
      provider: "anthropic",
      profileIds: ["ok", 5],
    });
    const handler = modelsAuthProfileMutationHandlers["models.authProfileReorder"];
    if (!handler) {
      throw new Error("handler missing");
    }
    await handler(opts);
    const res = lastResponse(opts.respond);
    expect(res.ok).toBe(false);
  });

  it("rejects missing provider", async () => {
    const opts = createOptions("models.authProfileReorder", {
      profileIds: ["anthropic:work"],
    });
    const handler = modelsAuthProfileMutationHandlers["models.authProfileReorder"];
    if (!handler) {
      throw new Error("handler missing");
    }
    await handler(opts);
    const res = lastResponse(opts.respond);
    expect(res.ok).toBe(false);
  });
});
