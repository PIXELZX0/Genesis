import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { GenesisConfig } from "../config/config.js";

const ensureGenesisModelsJsonMock = vi.fn<
  (config: unknown, agentDir: unknown) => Promise<{ agentDir: string; wrote: boolean }>
>(async () => ({ agentDir: "/tmp/agent", wrote: false }));
const resolveModelMock = vi.fn<
  (
    provider: unknown,
    modelId: unknown,
    agentDir: unknown,
    cfg: unknown,
    options?: unknown,
  ) => { model: { id: string; provider: string; api: string } }
>(() => ({
  model: {
    id: "gpt-5.4",
    provider: "openai-codex",
    api: "openai-codex-responses",
  },
}));
const resolveModelAsyncMock = vi.fn<
  (
    provider: unknown,
    modelId: unknown,
    agentDir: unknown,
    cfg: unknown,
  ) => Promise<{ model?: { id: string; provider: string; api: string }; error?: string }>
>(async () => ({
  model: {
    id: "gpt-5.4",
    provider: "openai-codex",
    api: "openai-codex-responses",
  },
}));
const selectAgentHarnessMock = vi.fn((_params: unknown) => ({ id: "pi" }));
const resolveEmbeddedAgentRuntimeMock = vi.fn(() => "auto");

vi.mock("../agents/agent-paths.js", () => ({
  resolveGenesisAgentDir: () => "/tmp/agent",
}));

vi.mock("../agents/models-config.js", () => ({
  ensureGenesisModelsJson: (config: unknown, agentDir: unknown) =>
    ensureGenesisModelsJsonMock(config, agentDir),
}));

vi.mock("../agents/harness/selection.js", () => ({
  selectAgentHarness: (params: unknown) => selectAgentHarnessMock(params),
}));

vi.mock("../agents/pi-embedded-runner/model.js", () => ({
  resolveModel: (
    provider: unknown,
    modelId: unknown,
    agentDir: unknown,
    cfg: unknown,
    options?: unknown,
  ) => resolveModelMock(provider, modelId, agentDir, cfg, options),
  resolveModelAsync: (provider: unknown, modelId: unknown, agentDir: unknown, cfg: unknown) =>
    resolveModelAsyncMock(provider, modelId, agentDir, cfg),
}));

vi.mock("../agents/pi-embedded-runner/runtime.js", () => ({
  resolveEmbeddedAgentRuntime: () => resolveEmbeddedAgentRuntimeMock(),
}));

let prewarmConfiguredPrimaryModel: typeof import("./server-startup.js").__testing.prewarmConfiguredPrimaryModel;

describe("gateway startup primary model warmup", () => {
  beforeAll(async () => {
    ({
      __testing: { prewarmConfiguredPrimaryModel },
    } = await import("./server-startup.js"));
  });

  beforeEach(() => {
    ensureGenesisModelsJsonMock.mockClear();
    resolveModelMock.mockClear();
    resolveModelAsyncMock.mockClear();
    selectAgentHarnessMock.mockClear();
    selectAgentHarnessMock.mockReturnValue({ id: "pi" });
    resolveEmbeddedAgentRuntimeMock.mockClear();
    resolveEmbeddedAgentRuntimeMock.mockReturnValue("auto");
  });

  it("prewarms an explicit configured primary model", async () => {
    const cfg = {
      agents: {
        defaults: {
          model: {
            primary: "openai-codex/gpt-5.4",
          },
        },
      },
    } as GenesisConfig;

    await prewarmConfiguredPrimaryModel({
      cfg,
      log: { warn: vi.fn() },
    });

    expect(ensureGenesisModelsJsonMock).toHaveBeenCalledWith(cfg, "/tmp/agent");
    expect(resolveModelMock).toHaveBeenCalledWith("openai-codex", "gpt-5.4", "/tmp/agent", cfg, {
      skipProviderRuntimeHooks: true,
    });
  });

  it("skips warmup when no explicit primary model is configured", async () => {
    await prewarmConfiguredPrimaryModel({
      cfg: {} as GenesisConfig,
      log: { warn: vi.fn() },
    });

    expect(ensureGenesisModelsJsonMock).not.toHaveBeenCalled();
    expect(resolveModelMock).not.toHaveBeenCalled();
  });

  it("skips static warmup for configured CLI backends", async () => {
    await prewarmConfiguredPrimaryModel({
      cfg: {
        agents: {
          defaults: {
            model: {
              primary: "codex-cli/gpt-5.5",
            },
            cliBackends: {
              "codex-cli": {
                command: "codex",
                args: ["exec"],
              },
            },
          },
        },
      } as GenesisConfig,
      log: { warn: vi.fn() },
    });

    expect(ensureGenesisModelsJsonMock).not.toHaveBeenCalled();
    expect(resolveModelMock).not.toHaveBeenCalled();
  });

  it("skips static warmup when another agent harness handles the model", async () => {
    selectAgentHarnessMock.mockReturnValue({ id: "codex" });
    const cfg = {
      agents: {
        defaults: {
          model: {
            primary: "codex/gpt-5.4",
          },
        },
      },
    } as GenesisConfig;

    await prewarmConfiguredPrimaryModel({
      cfg,
      log: { warn: vi.fn() },
    });

    expect(selectAgentHarnessMock).toHaveBeenCalledWith({
      provider: "codex",
      modelId: "gpt-5.4",
      config: cfg,
    });
    expect(ensureGenesisModelsJsonMock).not.toHaveBeenCalled();
    expect(resolveModelMock).not.toHaveBeenCalled();
  });

  it("skips static warmup when a non-PI agent runtime is forced", async () => {
    resolveEmbeddedAgentRuntimeMock.mockReturnValue("codex");
    await prewarmConfiguredPrimaryModel({
      cfg: {
        agents: {
          defaults: {
            model: {
              primary: "codex/gpt-5.4",
            },
          },
        },
      } as GenesisConfig,
      log: { warn: vi.fn() },
    });

    expect(selectAgentHarnessMock).not.toHaveBeenCalled();
    expect(ensureGenesisModelsJsonMock).not.toHaveBeenCalled();
    expect(resolveModelMock).not.toHaveBeenCalled();
  });

  it("keeps PI static warmup when the PI agent runtime is forced", async () => {
    resolveEmbeddedAgentRuntimeMock.mockReturnValue("pi");
    const cfg = {
      agents: {
        defaults: {
          model: {
            primary: "openai-codex/gpt-5.4",
          },
        },
      },
    } as GenesisConfig;

    await prewarmConfiguredPrimaryModel({
      cfg,
      log: { warn: vi.fn() },
    });

    expect(selectAgentHarnessMock).toHaveBeenCalledWith({
      provider: "openai-codex",
      modelId: "gpt-5.4",
      config: cfg,
    });
    expect(ensureGenesisModelsJsonMock).toHaveBeenCalledWith(cfg, "/tmp/agent");
    expect(resolveModelMock).toHaveBeenCalled();
  });

  it("falls back to async model resolution before warning", async () => {
    resolveModelMock.mockReturnValueOnce({ model: undefined } as never);
    resolveModelAsyncMock.mockResolvedValueOnce({
      model: {
        id: "gpt-5.4",
        provider: "codex",
        api: "openai-codex-responses",
      },
    });
    const warn = vi.fn();
    const cfg = {
      agents: {
        defaults: {
          model: {
            primary: "codex/gpt-5.4",
          },
        },
      },
    } as GenesisConfig;

    await prewarmConfiguredPrimaryModel({ cfg, log: { warn } });

    expect(resolveModelAsyncMock).toHaveBeenCalledWith("codex", "gpt-5.4", "/tmp/agent", cfg);
    expect(warn).not.toHaveBeenCalled();
  });

  it("warns only when both static and async model resolution miss", async () => {
    resolveModelMock.mockReturnValueOnce({ model: undefined, error: "static miss" } as never);
    resolveModelAsyncMock.mockResolvedValueOnce({ error: "async miss" });
    const warn = vi.fn();

    await prewarmConfiguredPrimaryModel({
      cfg: {
        agents: {
          defaults: {
            model: {
              primary: "codex/gpt-5.4",
            },
          },
        },
      } as GenesisConfig,
      log: { warn },
    });

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("startup model warmup failed for codex/gpt-5.4"),
    );
  });
});
