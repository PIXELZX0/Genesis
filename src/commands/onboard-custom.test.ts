import { afterEach, describe, expect, it, vi } from "vitest";
import type { ensureApiKeyFromEnvOrPrompt } from "../plugins/provider-auth-input.js";
import { promptCustomApiConfig } from "./onboard-custom.js";

const fetchWithSsrFGuardMock = vi.hoisted(() => vi.fn());

vi.mock("../infra/net/fetch-guard.js", () => ({
  fetchWithSsrFGuard: fetchWithSsrFGuardMock,
}));

const OLLAMA_OPENAI_COMPATIBLE_BASE_URL_FOR_TEST = "http://127.0.0.1:11434/v1";

vi.mock("../plugins/provider-auth-input.js", () => ({
  ensureApiKeyFromEnvOrPrompt: vi.fn(
    async (params: Parameters<typeof ensureApiKeyFromEnvOrPrompt>[0]) => {
      await params.prompter.select({ message: "Secret input mode", options: [] });
      const input = await params.prompter.text({
        message: params.promptMessage,
        validate: params.validate,
      });
      const apiKey = params.normalize(input ?? "");
      await params.setCredential(apiKey);
      return apiKey;
    },
  ),
}));

function createTestPrompter(params: { text: string[]; select?: string[] }): {
  text: ReturnType<typeof vi.fn>;
  select: ReturnType<typeof vi.fn>;
  confirm: ReturnType<typeof vi.fn>;
  note: ReturnType<typeof vi.fn>;
  progress: ReturnType<typeof vi.fn>;
} {
  const text = vi.fn();
  for (const answer of params.text) {
    text.mockResolvedValueOnce(answer);
  }
  const select = vi.fn();
  for (const answer of params.select ?? []) {
    select.mockResolvedValueOnce(answer);
  }
  return {
    text,
    progress: vi.fn(() => ({
      update: vi.fn(),
      stop: vi.fn(),
    })),
    select,
    confirm: vi.fn(),
    note: vi.fn(),
  };
}

function stubFetchSequence(
  responses: Array<{ ok: boolean; status?: number }>,
): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn();
  for (const response of responses) {
    fetchMock.mockResolvedValueOnce({
      ok: response.ok,
      status: response.status,
      json: async () => ({}),
    });
  }
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function runPromptCustomApi(
  prompter: ReturnType<typeof createTestPrompter>,
  config: object = {},
  verification?: Parameters<typeof promptCustomApiConfig>[0]["verification"],
  setDefault?: boolean,
) {
  return promptCustomApiConfig({
    prompter: prompter as unknown as Parameters<typeof promptCustomApiConfig>[0]["prompter"],
    runtime: { log: vi.fn() } as unknown as Parameters<typeof promptCustomApiConfig>[0]["runtime"],
    config,
    verification,
    setDefault,
  });
}

function expectOpenAiCompatResult(params: {
  prompter: ReturnType<typeof createTestPrompter>;
  textCalls: number;
  selectCalls: number;
  result: Awaited<ReturnType<typeof runPromptCustomApi>>;
}) {
  expect(params.prompter.text).toHaveBeenCalledTimes(params.textCalls);
  expect(params.prompter.select).toHaveBeenCalledTimes(params.selectCalls);
  expect(params.result.config.models?.providers?.custom?.api).toBe("openai-completions");
}

describe("promptCustomApiConfig", () => {
  afterEach(() => {
    fetchWithSsrFGuardMock.mockReset();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it("handles openai flow and saves alias", async () => {
    const prompter = createTestPrompter({
      text: ["http://localhost:11434/v1", "", "llama3", "custom", "local"],
      select: ["plaintext", "openai"],
    });
    stubFetchSequence([{ ok: true }]);
    const result = await runPromptCustomApi(prompter);

    expectOpenAiCompatResult({ prompter, textCalls: 5, selectCalls: 2, result });
    expect(fetchWithSsrFGuardMock).not.toHaveBeenCalled();
    expect(result.config.agents?.defaults?.model).toEqual({ primary: "custom/llama3" });
    expect(result.config.agents?.defaults?.models?.["custom/llama3"]?.alias).toBe("local");
  });

  it("defaults custom setup to the OpenAI-compatible Ollama base URL", async () => {
    const prompter = createTestPrompter({
      text: ["http://localhost:11434", "", "llama3", "custom", ""],
      select: ["plaintext", "openai"],
    });
    stubFetchSequence([{ ok: true }]);

    await runPromptCustomApi(prompter);

    expect(prompter.text).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "API Base URL",
        initialValue: OLLAMA_OPENAI_COMPATIBLE_BASE_URL_FOR_TEST,
      }),
    );
  });

  it("retries when verification fails", async () => {
    const prompter = createTestPrompter({
      text: ["http://localhost:11434/v1", "", "bad-model", "good-model", "custom", ""],
      select: ["plaintext", "openai", "model"],
    });
    stubFetchSequence([{ ok: false, status: 400 }, { ok: true }]);
    await runPromptCustomApi(prompter);

    expect(prompter.text).toHaveBeenCalledTimes(6);
    expect(prompter.select).toHaveBeenCalledTimes(3);
  });

  it("detects openai compatibility when unknown", async () => {
    const prompter = createTestPrompter({
      text: ["https://example.com/v1", "test-key", "detected-model", "custom", "alias"],
      select: ["plaintext", "unknown"],
    });
    stubFetchSequence([{ ok: true }]);
    const result = await runPromptCustomApi(prompter);

    expectOpenAiCompatResult({ prompter, textCalls: 5, selectCalls: 2, result });
  });

  it("re-prompts base url when unknown detection fails", async () => {
    const prompter = createTestPrompter({
      text: [
        "https://bad.example.com/v1",
        "bad-key",
        "bad-model",
        "https://ok.example.com/v1",
        "ok-key",
        "custom",
        "",
      ],
      select: ["plaintext", "unknown", "baseUrl", "plaintext"],
    });
    stubFetchSequence([{ ok: false, status: 404 }, { ok: false, status: 404 }, { ok: true }]);
    await runPromptCustomApi(prompter);

    expect(prompter.note).toHaveBeenCalledWith(
      expect.stringContaining("did not respond"),
      "Endpoint detection",
    );
  });

  it("aborts verification after timeout", async () => {
    vi.useFakeTimers();
    const prompter = createTestPrompter({
      text: ["http://localhost:11434/v1", "", "slow-model", "fast-model", "custom", ""],
      select: ["plaintext", "openai", "model"],
    });

    const fetchMock = vi
      .fn()
      .mockImplementationOnce((_url: string, init?: { signal?: AbortSignal }) => {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("AbortError")));
        });
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);

    const promise = runPromptCustomApi(prompter);

    await vi.advanceTimersByTimeAsync(30_000);
    await promise;

    expect(prompter.text).toHaveBeenCalledTimes(6);
  });

  it("uses strict guarded verification and releases the guard result for web setup", async () => {
    const prompter = createTestPrompter({
      text: ["https://example.com/v1", "", "test-model", "custom", ""],
      select: ["plaintext", "openai"],
    });
    const cleanupEvents: string[] = [];
    const bodyCancel = vi.fn(async () => {
      cleanupEvents.push("cancel");
    });
    const release = vi.fn(async () => {
      cleanupEvents.push("release");
    });
    fetchWithSsrFGuardMock.mockResolvedValue({
      response: { ok: true, status: 200, body: { cancel: bodyCancel } },
      release,
    });

    await runPromptCustomApi(prompter, {}, { mode: "web", allowPrivateNetwork: false });

    expect(fetchWithSsrFGuardMock).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://example.com/v1/chat/completions",
        mode: "strict",
        capture: false,
        maxRedirects: 3,
        allowCrossOriginUnsafeRedirectReplay: false,
        timeoutMs: 30_000,
        policy: { allowPrivateNetwork: false },
      }),
    );
    expect(bodyCancel).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledOnce();
    expect(cleanupEvents).toEqual(["cancel", "release"]);
  });

  it("continues verification handling when guarded body cleanup fails", async () => {
    const prompter = createTestPrompter({
      text: ["https://example.com/v1", "", "bad-model", "good-model", "custom", ""],
      select: ["plaintext", "openai", "model"],
    });
    const bodyCancel = vi.fn(async () => {
      throw new Error("cancel failed");
    });
    const release = vi.fn(async () => {});
    fetchWithSsrFGuardMock
      .mockResolvedValueOnce({
        response: { ok: false, status: 400, body: { cancel: bodyCancel } },
        release,
      })
      .mockResolvedValueOnce({
        response: { ok: true, status: 200 },
        release,
      });

    await runPromptCustomApi(prompter, {}, { mode: "web", allowPrivateNetwork: false });

    expect(prompter.text).toHaveBeenCalledTimes(6);
    expect(bodyCancel).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledTimes(2);
  });

  it("keeps the existing primary while registering a web custom model", async () => {
    const prompter = createTestPrompter({
      text: ["https://example.com/v1", "", "test-model", "custom", ""],
      select: ["plaintext", "openai"],
    });
    fetchWithSsrFGuardMock.mockResolvedValue({
      response: { ok: true, status: 200 },
      release: vi.fn(async () => {}),
    });

    const result = await runPromptCustomApi(
      prompter,
      {
        agents: {
          defaults: {
            model: { primary: "anthropic/claude-opus-4-8" },
            models: { "anthropic/claude-opus-4-8": { alias: "opus" } },
          },
        },
      },
      { mode: "web", allowPrivateNetwork: false },
      false,
    );

    expect(result.config.agents?.defaults?.model).toEqual({
      primary: "anthropic/claude-opus-4-8",
    });
    expect(result.config.agents?.defaults?.models).toEqual({
      "anthropic/claude-opus-4-8": { alias: "opus" },
      "custom/test-model": {},
    });
    expect(result.config.models?.providers?.custom?.models?.[0]?.id).toBe("test-model");
  });

  it("validates web aliases when no model allowlist exists", async () => {
    const prompter = createTestPrompter({
      text: ["https://example.com/v1", "", "test-model", "custom", ""],
      select: ["plaintext", "openai"],
    });
    fetchWithSsrFGuardMock.mockResolvedValue({
      response: { ok: true, status: 200 },
      release: vi.fn(async () => {}),
    });

    await runPromptCustomApi(prompter, {}, { mode: "web", allowPrivateNetwork: false }, false);

    const aliasPrompt = prompter.text.mock.calls.find(
      ([params]) => params?.message === "Model alias (optional)",
    )?.[0] as { validate?: (value: string) => string | undefined } | undefined;
    if (!aliasPrompt?.validate) {
      throw new Error("expected alias prompt validator");
    }

    expect(aliasPrompt.validate("local")).toBe(
      "Model aliases require an existing non-empty model allowlist. Leave the alias blank to keep all models available.",
    );
    expect(aliasPrompt.validate("")).toBeUndefined();
  });

  it("passes private network opt-in to guarded verification and provider config", async () => {
    const prompter = createTestPrompter({
      text: ["http://127.0.0.1:11434/v1", "", "llama3", "custom", ""],
      select: ["plaintext", "openai"],
    });
    fetchWithSsrFGuardMock.mockResolvedValue({
      response: { ok: true, status: 200 },
      release: vi.fn(async () => {}),
    });

    const result = await runPromptCustomApi(
      prompter,
      {},
      { mode: "web", allowPrivateNetwork: true },
    );

    expect(fetchWithSsrFGuardMock).toHaveBeenCalledWith(
      expect.objectContaining({ policy: { allowPrivateNetwork: true } }),
    );
    expect(result.config.models?.providers?.custom?.request?.allowPrivateNetwork).toBe(true);
  });
});
