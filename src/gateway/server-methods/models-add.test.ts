import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GenesisConfig } from "../../config/types.genesis.js";

const mocks = vi.hoisted(() => ({
  config: {} as GenesisConfig,
  written: null as GenesisConfig | null,
  resetCatalog: vi.fn(),
}));

vi.mock("../../config/config.js", async () => {
  const actual =
    await vi.importActual<typeof import("../../config/config.js")>("../../config/config.js");
  return {
    ...actual,
    loadConfig: () => mocks.config,
    readConfigFileSnapshotForWrite: async () => ({
      snapshot: { config: mocks.config },
      writeOptions: {},
    }),
    writeConfigFileWithResult: async (cfg: GenesisConfig) => {
      mocks.written = cfg;
    },
  };
});

vi.mock("../../agents/model-catalog.js", () => ({
  resetModelCatalogCache: mocks.resetCatalog,
}));

const { modelsHandlers } = await import("./models.js");

function call(params: Record<string, unknown>) {
  const respond = vi.fn();
  const handler = modelsHandlers["models.add"];
  const promise = handler({
    params,
    respond,
    context: {} as never,
  } as never);
  return { respond, promise };
}

describe("models.add", () => {
  beforeEach(() => {
    mocks.config = {} as GenesisConfig;
    mocks.written = null;
    mocks.resetCatalog.mockClear();
  });

  it("adds a model to a new provider and persists config", async () => {
    const { respond, promise } = call({
      provider: "anthropic",
      id: "claude-opus-4-8",
      name: "Opus 4.8",
      contextWindow: 200000,
    });
    await promise;

    expect(respond).toHaveBeenCalledWith(
      true,
      { ok: true, provider: "anthropic", id: "claude-opus-4-8", name: "Opus 4.8" },
      undefined,
    );
    const models = mocks.written?.models?.providers?.anthropic?.models ?? [];
    expect(models).toHaveLength(1);
    expect(models[0]).toMatchObject({
      id: "claude-opus-4-8",
      name: "Opus 4.8",
      contextWindow: 200000,
      metadataSource: "models-add",
    });
    expect(mocks.resetCatalog).toHaveBeenCalledOnce();
  });

  it("appends to an existing provider without dropping prior models", async () => {
    mocks.config = {
      models: {
        providers: {
          anthropic: {
            baseUrl: "https://api.anthropic.com",
            models: [
              {
                id: "existing",
                name: "existing",
                reasoning: false,
                input: ["text"],
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                contextWindow: 1000,
                maxTokens: 100,
              },
            ],
          },
        },
      },
    } as GenesisConfig;

    const { respond, promise } = call({ provider: "anthropic", id: "new-model" });
    await promise;

    expect(respond).toHaveBeenCalledWith(true, expect.anything(), undefined);
    const provider = mocks.written?.models?.providers?.anthropic;
    expect(provider?.baseUrl).toBe("https://api.anthropic.com");
    expect(provider?.models.map((m) => m.id)).toEqual(["existing", "new-model"]);
  });

  it("rejects a duplicate model id for the same provider", async () => {
    mocks.config = {
      models: {
        providers: {
          openai: {
            baseUrl: "",
            models: [
              {
                id: "gpt-5",
                name: "gpt-5",
                reasoning: false,
                input: ["text"],
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                contextWindow: 1000,
                maxTokens: 100,
              },
            ],
          },
        },
      },
    } as GenesisConfig;

    const { respond, promise } = call({ provider: "openai", id: "gpt-5" });
    await promise;

    expect(respond).toHaveBeenCalledWith(false, undefined, expect.anything());
    expect(mocks.written).toBeNull();
  });

  it("rejects missing provider or id", async () => {
    const a = call({ id: "x" });
    await a.promise;
    expect(a.respond).toHaveBeenCalledWith(false, undefined, expect.anything());

    const b = call({ provider: "x" });
    await b.promise;
    expect(b.respond).toHaveBeenCalledWith(false, undefined, expect.anything());
    expect(mocks.written).toBeNull();
  });

  it("rejects an unknown api value", async () => {
    const { respond, promise } = call({ provider: "x", id: "y", api: "not-real" });
    await promise;
    expect(respond).toHaveBeenCalledWith(false, undefined, expect.anything());
    expect(mocks.written).toBeNull();
  });
});
