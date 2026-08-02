import { describe, expect, it, vi } from "vitest";
import { activatePiIsolationProviderRuntime } from "./provider-activation.js";

describe("PI isolation provider activation", () => {
  it("targets both the attempt provider and raw model provider before runtime planning", () => {
    const resolvePluginProviders = vi.fn(() => []);
    const config = { plugins: { enabled: true } };
    const env = { GENESIS_PROFILE: "test" };

    const providerRefs = activatePiIsolationProviderRuntime({
      attemptProvider: "openai-codex",
      modelProvider: "openai",
      config,
      workspaceDir: "/tmp/workspace",
      env,
      resolvePluginProviders: resolvePluginProviders as never,
    });

    expect(providerRefs).toEqual(["openai", "openai-codex"]);
    expect(resolvePluginProviders).toHaveBeenCalledOnce();
    expect(resolvePluginProviders).toHaveBeenCalledWith({
      providerRefs: ["openai", "openai-codex"],
      activate: true,
      mode: "runtime",
      config,
      workspaceDir: "/tmp/workspace",
      env,
    });
  });

  it("deduplicates identical provider refs", () => {
    const resolvePluginProviders = vi.fn(() => []);
    expect(
      activatePiIsolationProviderRuntime({
        attemptProvider: "anthropic",
        modelProvider: "anthropic",
        workspaceDir: "/tmp/workspace",
        env: {},
        resolvePluginProviders: resolvePluginProviders as never,
      }),
    ).toEqual(["anthropic"]);
  });
});
