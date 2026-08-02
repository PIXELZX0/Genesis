import fs from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import type { Api, Model } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  initializeGlobalHookRunner,
  resetGlobalHookRunner,
} from "../../../plugins/hook-runner-global.js";
import { createMockPluginRegistry } from "../../../plugins/hooks.test-helpers.js";
import { createPiAgentHarness } from "../../harness/builtin-pi.js";
import {
  createPiModelRuntime,
  createRuntimeCredentialStore,
  ModelRegistry,
} from "../../pi-model-discovery.js";

const RUN_WATCHDOG_MS = 180_000;
const TEST_TIMEOUT_MS = 240_000;

let tempRoot: string | undefined;
let server: http.Server | undefined;
let activeRunAbortController: AbortController | undefined;
let activeRunSettled: Promise<void> | undefined;
let activeRunTimeout: NodeJS.Timeout | undefined;

afterEach(async () => {
  resetGlobalHookRunner();
  if (activeRunTimeout) {
    clearTimeout(activeRunTimeout);
    activeRunTimeout = undefined;
  }
  activeRunAbortController?.abort(new Error("isolated E2E teardown"));
  activeRunAbortController = undefined;
  await activeRunSettled;
  activeRunSettled = undefined;
  if (server) {
    const closed = new Promise<void>((resolve, reject) =>
      server?.close((error) => (error ? reject(error) : resolve())),
    );
    server.closeAllConnections();
    await closed;
    server = undefined;
  }
  if (tempRoot) {
    await fs.rm(tempRoot, { recursive: true, force: true });
    tempRoot = undefined;
  }
}, 60_000);

function writeSseResponse(response: http.ServerResponse, requestNumber: number): void {
  response.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "close",
  });
  const base = {
    id: "chatcmpl-isolated",
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model: "isolated-model",
  };
  response.write(
    `data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] })}\n\n`,
  );
  if (requestNumber === 1) {
    response.write(
      `data: ${JSON.stringify({
        ...base,
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "call_isolated_read",
                  type: "function",
                  function: {
                    name: "read",
                    arguments: JSON.stringify({ path: "fixture.txt" }),
                  },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      })}\n\n`,
    );
    response.write(
      `data: ${JSON.stringify({
        ...base,
        choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
        usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
      })}\n\n`,
    );
    response.end("data: [DONE]\n\n");
    return;
  }
  response.write(
    `data: ${JSON.stringify({
      ...base,
      choices: [
        {
          index: 0,
          delta: {
            content: "isolated child ok",
            tool_calls: [
              {
                index: 0,
                id: "call_isolated_yield",
                type: "function",
                function: {
                  name: "sessions_yield",
                  arguments: JSON.stringify({ message: "Waiting for isolated follow-up" }),
                },
              },
            ],
          },
          finish_reason: null,
        },
      ],
    })}\n\n`,
  );
  response.write(
    `data: ${JSON.stringify({
      ...base,
      choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
      usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
    })}\n\n`,
  );
  response.end("data: [DONE]\n\n");
}

describe("isolated PI run", () => {
  it(
    "executes parent tools and bridged attempt hooks in a real child process",
    async () => {
      let requestCount = 0;
      let authorization: string | undefined;
      const requestBodies: string[] = [];
      tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "genesis-pi-isolated-e2e-"));
      const workspaceDir = path.join(tempRoot, "workspace");
      const agentDir = path.join(tempRoot, "agent");
      await fs.mkdir(workspaceDir, { recursive: true });
      await fs.mkdir(agentDir, { recursive: true });
      await fs.writeFile(path.join(workspaceDir, "fixture.txt"), "isolated fixture content\n");

      server = http.createServer((request, response) => {
        requestCount += 1;
        authorization = request.headers.authorization;
        if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
          response.writeHead(404).end();
          return;
        }
        const chunks: Buffer[] = [];
        request.on("data", (chunk: Buffer) => chunks.push(chunk));
        request.once("end", () => {
          requestBodies.push(Buffer.concat(chunks).toString("utf8"));
          writeSseResponse(response, requestCount);
        });
      });
      await new Promise<void>((resolve, reject) => {
        server?.once("error", reject);
        server?.listen(0, "127.0.0.1", resolve);
      });
      const address = server.address() as AddressInfo;
      const baseUrl = `http://127.0.0.1:${address.port}/v1`;
      const model = {
        id: "isolated-model",
        name: "Isolated model",
        provider: "openai",
        api: "openai-completions",
        baseUrl,
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 16_000,
        maxTokens: 1_024,
      } as Model<Api>;
      const beforePromptBuild = vi.fn(async () => ({
        prependContext: "bridged prompt context",
        appendSystemContext: "bridged system suffix",
      }));
      const agentEnd = vi.fn(async (_event: unknown) => undefined);
      initializeGlobalHookRunner(
        createMockPluginRegistry([
          { hookName: "before_prompt_build", handler: beforePromptBuild },
          { hookName: "agent_end", handler: agentEnd },
        ]),
      );
      const modelsPath = path.join(agentDir, "models.json");
      await fs.writeFile(
        modelsPath,
        `${JSON.stringify(
          {
            providers: {
              [model.provider]: {
                api: model.api,
                baseUrl: model.baseUrl,
                models: [
                  {
                    id: model.id,
                    name: model.name,
                    reasoning: model.reasoning,
                    input: model.input,
                    cost: model.cost,
                    contextWindow: model.contextWindow,
                    maxTokens: model.maxTokens,
                  },
                ],
              },
            },
          },
          null,
          2,
        )}\n`,
        "utf8",
      );
      const authStorage = createRuntimeCredentialStore({});
      authStorage.setRuntimeApiKey(model.provider, "sk-test-secret");
      const modelRegistry = new ModelRegistry(await createPiModelRuntime(authStorage, modelsPath));
      const events: Array<{ stream: string; data: Record<string, unknown> }> = [];
      const sessionFile = path.join(agentDir, "session.jsonl");
      const abortController = new AbortController();
      activeRunAbortController = abortController;
      activeRunTimeout = setTimeout(() => {
        abortController.abort(
          new Error(`isolated E2E watchdog expired after ${RUN_WATCHDOG_MS / 1_000}s`),
        );
      }, RUN_WATCHDOG_MS);

      const running = createPiAgentHarness().runAttempt({
        sessionId: "isolated-session",
        sessionKey: "agent:main:isolated-session",
        runId: "isolated-run",
        sessionFile,
        workspaceDir,
        agentDir,
        config: {
          plugins: { enabled: false },
          models: {
            providers: {
              [model.provider]: {
                api: "openai-completions",
                baseUrl,
                models: [
                  {
                    id: model.id,
                    name: model.name,
                    api: "openai-completions",
                    reasoning: false,
                    input: ["text"],
                    cost: model.cost,
                    contextWindow: model.contextWindow,
                    maxTokens: model.maxTokens,
                  },
                ],
              },
            },
          },
        },
        prompt: "Reply with the test phrase.",
        provider: model.provider,
        modelId: model.id,
        model,
        authStorage,
        modelRegistry,
        thinkLevel: "off",
        timeoutMs: 15_000,
        toolsAllow: ["read", "sessions_yield"],
        abortSignal: abortController.signal,
        onAgentEvent: (event) => events.push(event),
      });
      activeRunSettled = running.then(
        () => undefined,
        () => undefined,
      );
      const result = await running.catch((error: unknown) => {
        const detail = error as { message?: string; stderr?: string };
        throw new Error(
          `${detail.message ?? String(error)}; requests=${requestCount}; events=${JSON.stringify(events)}; stderr=${detail.stderr ?? "<empty>"}`,
          { cause: error },
        );
      });
      if (activeRunTimeout) {
        clearTimeout(activeRunTimeout);
        activeRunTimeout = undefined;
      }
      activeRunAbortController = undefined;
      await activeRunSettled;
      activeRunSettled = undefined;
      await result.flushTerminalLifecycleEvent?.();

      expect(result.piIsolation).toMatchObject({
        mode: "isolated",
        protocolVersion: 1,
      });
      expect(result.piIsolation?.childPid).not.toBe(process.pid);
      expect(result).toMatchObject({
        aborted: false,
        externalAbort: false,
        yieldDetected: true,
      });
      expect(requestCount).toBe(2);
      expect(authorization).toBe("Bearer sk-test-secret");
      expect(requestBodies[0]).toContain("bridged prompt context");
      expect(requestBodies[0]).toContain("bridged system suffix");
      const secondRequest = JSON.parse(requestBodies[1] ?? "") as {
        messages?: Array<{
          role?: string;
          tool_call_id?: string;
          tool_calls?: Array<{ id?: string; function?: { name?: string } }>;
          content?: string;
        }>;
      };
      const bridgedToolCall = secondRequest.messages
        ?.flatMap((message) => message.tool_calls ?? [])
        .find((toolCall) => toolCall.function?.name === "read");
      const bridgedToolResult = secondRequest.messages?.find(
        (message) => message.role === "tool" && message.tool_call_id === bridgedToolCall?.id,
      );
      expect(bridgedToolCall?.id).toBeTruthy();
      expect(bridgedToolResult?.content).toContain("isolated fixture content");
      expect(
        result.assistantTexts.join("\n"),
        JSON.stringify({
          requestCount,
          events,
          promptError:
            result.promptError instanceof Error
              ? {
                  name: result.promptError.name,
                  message: result.promptError.message,
                  stack: result.promptError.stack,
                }
              : result.promptError,
          promptErrorSource: result.promptErrorSource,
          messagesSnapshot: result.messagesSnapshot,
        }),
      ).toContain("isolated child ok");
      expect(events.map((event) => `${event.stream}:${String(event.data.phase)}`)).toEqual(
        expect.arrayContaining(["lifecycle:start", "lifecycle:end"]),
      );
      const transcript = await fs.readFile(sessionFile, "utf8");
      expect(transcript).toContain("call_isolated_read");
      expect(transcript).toContain("isolated fixture content");
      expect(transcript).toContain("call_isolated_yield");
      expect(transcript).toContain("Waiting for isolated follow-up");
      expect(transcript).toContain("genesis.sessions_yield");
      expect(transcript).not.toContain("genesis.sessions_yield_interrupt");
      expect(beforePromptBuild).toHaveBeenCalledOnce();
      await vi.waitFor(() => expect(agentEnd).toHaveBeenCalledOnce());
      expect(agentEnd.mock.calls[0]?.[0]).toMatchObject({ success: true });
      await expect(fs.stat(`${sessionFile}.lock`)).rejects.toMatchObject({ code: "ENOENT" });
    },
    TEST_TIMEOUT_MS,
  );
});
