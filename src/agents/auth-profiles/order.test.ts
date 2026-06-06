import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { saveAuthProfileStore } from "./store.js";
import type { AuthProfileStore } from "./types.js";

const loadPluginManifestRegistry = vi.hoisted(() =>
  vi.fn(() => ({
    plugins: [
      {
        id: "fixture-provider",
        providerAuthAliases: { "fixture-provider-plan": "fixture-provider" },
      },
    ],
    diagnostics: [],
  })),
);

vi.mock("../../plugins/manifest-registry.js", () => ({
  loadPluginManifestRegistry,
}));

vi.mock("./external-auth.js", () => ({
  overlayExternalAuthProfiles: <T>(store: T) => store,
  shouldPersistExternalAuthProfile: () => true,
}));

async function importAuthProfileModulesWithAliasRegistry() {
  vi.resetModules();
  vi.doMock("../../plugins/manifest-registry.js", () => ({
    loadPluginManifestRegistry,
  }));
  const [{ resolveAuthProfileOrder }, { markAuthProfileGood }] = await Promise.all([
    import("./order.js"),
    import("./profiles.js"),
  ]);
  return { markAuthProfileGood, resolveAuthProfileOrder };
}

describe("resolveAuthProfileOrder", () => {
  beforeEach(() => {
    loadPluginManifestRegistry.mockClear();
  });

  afterEach(() => {
    vi.doUnmock("../../plugins/manifest-registry.js");
    vi.resetModules();
  });

  it("accepts aliased provider credentials from manifest metadata", async () => {
    const { resolveAuthProfileOrder } = await importAuthProfileModulesWithAliasRegistry();
    const store: AuthProfileStore = {
      version: 1,
      profiles: {
        "fixture-provider:default": {
          type: "api_key",
          provider: "fixture-provider",
          key: "sk-test",
        },
      },
    };

    const order = resolveAuthProfileOrder({
      store,
      provider: "fixture-provider-plan",
    });

    expect(order).toEqual(["fixture-provider:default"]);
  });

  it("uses canonical provider auth order for alias providers", async () => {
    const { resolveAuthProfileOrder } = await importAuthProfileModulesWithAliasRegistry();
    const store: AuthProfileStore = {
      version: 1,
      profiles: {
        "fixture-provider:primary": {
          type: "api_key",
          provider: "fixture-provider",
          key: "sk-primary",
        },
        "fixture-provider:secondary": {
          type: "api_key",
          provider: "fixture-provider",
          key: "sk-secondary",
        },
      },
      order: {
        "fixture-provider": ["fixture-provider:secondary", "fixture-provider:primary"],
      },
    };

    const order = resolveAuthProfileOrder({
      store,
      provider: "fixture-provider-plan",
    });

    expect(order).toEqual(["fixture-provider:secondary", "fixture-provider:primary"]);
  });

  it("falls back to legacy stored auth order when alias order is empty", async () => {
    const { resolveAuthProfileOrder } = await importAuthProfileModulesWithAliasRegistry();
    const store: AuthProfileStore = {
      version: 1,
      profiles: {
        "fixture-provider:primary": {
          type: "api_key",
          provider: "fixture-provider",
          key: "sk-primary",
        },
        "fixture-provider:secondary": {
          type: "api_key",
          provider: "fixture-provider",
          key: "sk-secondary",
        },
      },
      order: {
        "fixture-provider-plan": [],
        "fixture-provider": ["fixture-provider:secondary", "fixture-provider:primary"],
      },
    };

    const order = resolveAuthProfileOrder({
      store,
      provider: "fixture-provider-plan",
    });

    expect(order).toEqual(["fixture-provider:secondary", "fixture-provider:primary"]);
  });

  it("falls back to legacy configured auth order when alias order is empty", async () => {
    const { resolveAuthProfileOrder } = await importAuthProfileModulesWithAliasRegistry();
    const store: AuthProfileStore = {
      version: 1,
      profiles: {
        "fixture-provider:primary": {
          type: "api_key",
          provider: "fixture-provider",
          key: "sk-primary",
        },
        "fixture-provider:secondary": {
          type: "api_key",
          provider: "fixture-provider",
          key: "sk-secondary",
        },
      },
    };

    const order = resolveAuthProfileOrder({
      cfg: {
        auth: {
          order: {
            "fixture-provider-plan": [],
            "fixture-provider": ["fixture-provider:secondary", "fixture-provider:primary"],
          },
        },
      },
      store,
      provider: "fixture-provider-plan",
    });

    expect(order).toEqual(["fixture-provider:secondary", "fixture-provider:primary"]);
  });

  it("keeps explicit empty configured auth order as a provider disable", async () => {
    const { resolveAuthProfileOrder } = await importAuthProfileModulesWithAliasRegistry();
    const store: AuthProfileStore = {
      version: 1,
      profiles: {
        "fixture-provider:primary": {
          type: "api_key",
          provider: "fixture-provider",
          key: "sk-primary",
        },
      },
    };

    const order = resolveAuthProfileOrder({
      cfg: {
        auth: {
          order: {
            "fixture-provider": [],
          },
        },
      },
      store,
      provider: "fixture-provider",
    });

    expect(order).toEqual([]);
  });

  it("keeps explicit empty stored auth order as a provider disable", async () => {
    const { resolveAuthProfileOrder } = await importAuthProfileModulesWithAliasRegistry();
    const store: AuthProfileStore = {
      version: 1,
      profiles: {
        "fixture-provider:primary": {
          type: "api_key",
          provider: "fixture-provider",
          key: "sk-primary",
        },
      },
      order: {
        "fixture-provider": [],
      },
    };

    const order = resolveAuthProfileOrder({
      cfg: {
        auth: {
          order: {
            "fixture-provider": ["fixture-provider:primary"],
          },
        },
      },
      store,
      provider: "fixture-provider",
    });

    expect(order).toEqual([]);
  });

  it("marks aliased provider profiles good under the canonical auth provider", async () => {
    const { markAuthProfileGood } = await importAuthProfileModulesWithAliasRegistry();
    const agentDir = await mkdtemp(path.join(os.tmpdir(), "genesis-auth-profile-alias-"));
    try {
      const store: AuthProfileStore = {
        version: 1,
        profiles: {
          "fixture-provider:default": {
            type: "api_key",
            provider: "fixture-provider",
            key: "sk-test",
          },
        },
      };
      saveAuthProfileStore(store, agentDir);

      await markAuthProfileGood({
        store,
        provider: "fixture-provider-plan",
        profileId: "fixture-provider:default",
        agentDir,
      });

      expect(store.lastGood).toEqual({
        "fixture-provider": "fixture-provider:default",
      });
    } finally {
      await rm(agentDir, { force: true, recursive: true });
    }
  });

  it("sorts by priority desc, ignoring type when priorities differ", async () => {
    const { resolveAuthProfileOrder } = await importAuthProfileModulesWithAliasRegistry();
    const store: AuthProfileStore = {
      version: 1,
      profiles: {
        // oauth with low priority still sorts BELOW api_key with high priority
        "fixture-provider:oauth-low": {
          type: "oauth",
          provider: "fixture-provider",
          access: "oauth-low",
          refresh: "r",
          expires: 0,
          priority: 1,
        },
        "fixture-provider:apikey-high": {
          type: "api_key",
          provider: "fixture-provider",
          key: "apikey-high",
          priority: 100,
        },
        "fixture-provider:apikey-mid": {
          type: "api_key",
          provider: "fixture-provider",
          key: "apikey-mid",
          priority: 50,
        },
      },
    };

    const order = resolveAuthProfileOrder({
      store,
      provider: "fixture-provider",
    });

    expect(order).toEqual([
      "fixture-provider:apikey-high",
      "fixture-provider:apikey-mid",
      "fixture-provider:oauth-low",
    ]);
  });

  it("uses type then lastUsed as tiebreakers when priorities are equal or partially set", async () => {
    const { resolveAuthProfileOrder } = await importAuthProfileModulesWithAliasRegistry();
    const now = Date.now();
    const store: AuthProfileStore = {
      version: 1,
      profiles: {
        "fixture-provider:oauth-50": {
          type: "oauth",
          provider: "fixture-provider",
          access: "oauth-50",
          refresh: "r",
          expires: 0,
          priority: 50,
        },
        "fixture-provider:token-50-old": {
          type: "token",
          provider: "fixture-provider",
          token: "token-50-old",
          priority: 50,
        },
        "fixture-provider:token-50-new": {
          type: "token",
          provider: "fixture-provider",
          token: "token-50-new",
          priority: 50,
        },
        "fixture-provider:apikey-unset": {
          type: "api_key",
          provider: "fixture-provider",
          key: "apikey-unset",
        },
        "fixture-provider:token-unset": {
          type: "token",
          provider: "fixture-provider",
          token: "token-unset",
        },
      },
      usageStats: {
        "fixture-provider:token-50-old": { lastUsed: now - 10_000 },
        "fixture-provider:token-50-new": { lastUsed: now - 1_000 },
        "fixture-provider:token-unset": { lastUsed: now - 5_000 },
      },
    };

    const order = resolveAuthProfileOrder({
      store,
      provider: "fixture-provider",
    });

    // priority=50 bucket: oauth > token-old > token-new
    // priority=unset bucket: token-unset > api_key-unset (token outranks api_key)
    expect(order).toEqual([
      "fixture-provider:oauth-50",
      "fixture-provider:token-50-old",
      "fixture-provider:token-50-new",
      "fixture-provider:token-unset",
      "fixture-provider:apikey-unset",
    ]);
  });

  it("treats priority=0 as set (not as falsy unset)", async () => {
    const { resolveAuthProfileOrder } = await importAuthProfileModulesWithAliasRegistry();
    const store: AuthProfileStore = {
      version: 1,
      profiles: {
        "fixture-provider:zero": {
          type: "api_key",
          provider: "fixture-provider",
          key: "zero",
          priority: 0,
        },
        "fixture-provider:unset": {
          type: "oauth",
          provider: "fixture-provider",
          access: "unset",
          refresh: "r",
          expires: 0,
        },
      },
    };

    const order = resolveAuthProfileOrder({
      store,
      provider: "fixture-provider",
    });

    // priority=0 sorts above priority=unset, even though oauth > api_key
    expect(order).toEqual(["fixture-provider:zero", "fixture-provider:unset"]);
  });

  it("moves cooldown profiles to the end, sorted by cooldown expiry", async () => {
    const { resolveAuthProfileOrder } = await importAuthProfileModulesWithAliasRegistry();
    const now = Date.now();
    const store: AuthProfileStore = {
      version: 1,
      profiles: {
        "fixture-provider:available-high": {
          type: "api_key",
          provider: "fixture-provider",
          key: "available-high",
          priority: 100,
        },
        "fixture-provider:cooldown-soon": {
          type: "oauth",
          provider: "fixture-provider",
          access: "cooldown-soon",
          refresh: "r",
          expires: 0,
          priority: 200,
        },
        "fixture-provider:cooldown-late": {
          type: "token",
          provider: "fixture-provider",
          token: "cooldown-late",
          priority: 150,
        },
      },
      usageStats: {
        "fixture-provider:cooldown-soon": { cooldownUntil: now + 5_000 },
        "fixture-provider:cooldown-late": { cooldownUntil: now + 60_000 },
      },
    };

    const order = resolveAuthProfileOrder({
      store,
      provider: "fixture-provider",
    });

    // available sorts first by priority; cooldown profiles move to end,
    // sorted by cooldown expiry ascending (sooner expiry first).
    expect(order).toEqual([
      "fixture-provider:available-high",
      "fixture-provider:cooldown-soon",
      "fixture-provider:cooldown-late",
    ]);
  });

  it("uses state-side priorities.<id> as metadata fallback when secret-side is unset", async () => {
    const { resolveAuthProfileOrder } = await importAuthProfileModulesWithAliasRegistry();
    const store: AuthProfileStore = {
      version: 1,
      profiles: {
        "fixture-provider:state-priority": {
          type: "api_key",
          provider: "fixture-provider",
          key: "state-priority",
        },
        "fixture-provider:secret-priority": {
          type: "api_key",
          provider: "fixture-provider",
          key: "secret-priority",
          priority: 50,
        },
      },
      priorities: {
        "fixture-provider:state-priority": 100,
      },
    };

    const order = resolveAuthProfileOrder({
      store,
      provider: "fixture-provider",
    });

    // state-side priority=100 beats secret-side priority=50
    expect(order).toEqual(["fixture-provider:state-priority", "fixture-provider:secret-priority"]);
  });

  it("uses config-side priority as last-resort fallback", async () => {
    const { resolveAuthProfileOrder } = await importAuthProfileModulesWithAliasRegistry();
    const store: AuthProfileStore = {
      version: 1,
      profiles: {
        "fixture-provider:config-priority": {
          type: "api_key",
          provider: "fixture-provider",
          key: "config-priority",
        },
        "fixture-provider:no-priority": {
          type: "api_key",
          provider: "fixture-provider",
          key: "no-priority",
        },
      },
    };

    const order = resolveAuthProfileOrder({
      cfg: {
        auth: {
          profiles: {
            "fixture-provider:config-priority": {
              provider: "fixture-provider",
              mode: "api_key",
              priority: 75,
            },
            "fixture-provider:no-priority": {
              provider: "fixture-provider",
              mode: "api_key",
            },
          },
        },
      },
      store,
      provider: "fixture-provider",
    });

    expect(order).toEqual(["fixture-provider:config-priority", "fixture-provider:no-priority"]);
  });

  it("explicit auth.order still wins over priority sort", async () => {
    const { resolveAuthProfileOrder } = await importAuthProfileModulesWithAliasRegistry();
    const store: AuthProfileStore = {
      version: 1,
      profiles: {
        "fixture-provider:high-priority": {
          type: "api_key",
          provider: "fixture-provider",
          key: "high",
          priority: 100,
        },
        "fixture-provider:low-priority": {
          type: "api_key",
          provider: "fixture-provider",
          key: "low",
          priority: 1,
        },
      },
      order: {
        "fixture-provider": ["fixture-provider:low-priority", "fixture-provider:high-priority"],
      },
    };

    const order = resolveAuthProfileOrder({
      store,
      provider: "fixture-provider",
    });

    // Explicit order takes precedence over priority, even when high-priority
    // would otherwise be first.
    expect(order).toEqual(["fixture-provider:low-priority", "fixture-provider:high-priority"]);
  });
});
