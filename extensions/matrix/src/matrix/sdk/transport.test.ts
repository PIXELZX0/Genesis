import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MatrixMediaSizeLimitError } from "../media-errors.js";
import { createMatrixGuardedFetch, performMatrixRequest } from "./transport.js";

const TEST_UNDICI_RUNTIME_DEPS_KEY = "__GENESIS_TEST_UNDICI_RUNTIME_DEPS__";

function clearTestUndiciRuntimeDepsOverride(): void {
  Reflect.deleteProperty(globalThis as object, TEST_UNDICI_RUNTIME_DEPS_KEY);
}

function stubRuntimeFetch(fetchImpl: typeof fetch): void {
  (globalThis as Record<string, unknown>)[TEST_UNDICI_RUNTIME_DEPS_KEY] = {
    Agent: function MockAgent() {},
    EnvHttpProxyAgent: function MockEnvHttpProxyAgent() {},
    ProxyAgent: function MockProxyAgent() {},
    fetch: fetchImpl,
  };
}

describe("performMatrixRequest", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    clearTestUndiciRuntimeDepsOverride();
  });

  afterEach(() => {
    clearTestUndiciRuntimeDepsOverride();
  });

  it("rejects oversized raw responses before buffering the whole body", async () => {
    stubRuntimeFetch(
      vi.fn(
        async () =>
          new Response("too-big", {
            status: 200,
            headers: {
              "content-length": "8192",
            },
          }),
      ),
    );

    await expect(
      performMatrixRequest({
        homeserver: "http://127.0.0.1:8008",
        accessToken: "token",
        method: "GET",
        endpoint: "/_matrix/media/v3/download/example/id",
        timeoutMs: 5000,
        raw: true,
        maxBytes: 1024,
        ssrfPolicy: { allowPrivateNetwork: true },
      }),
    ).rejects.toBeInstanceOf(MatrixMediaSizeLimitError);
  });

  it("applies streaming byte limits when raw responses omit content-length", async () => {
    const chunk = new Uint8Array(768);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(chunk);
        controller.enqueue(chunk);
        controller.close();
      },
    });
    stubRuntimeFetch(
      vi.fn(
        async () =>
          new Response(stream, {
            status: 200,
          }),
      ),
    );

    await expect(
      performMatrixRequest({
        homeserver: "http://127.0.0.1:8008",
        accessToken: "token",
        method: "GET",
        endpoint: "/_matrix/media/v3/download/example/id",
        timeoutMs: 5000,
        raw: true,
        maxBytes: 1024,
        ssrfPolicy: { allowPrivateNetwork: true },
      }),
    ).rejects.toBeInstanceOf(MatrixMediaSizeLimitError);
  });

  it("uses the matrix-specific idle-timeout error for stalled raw downloads", async () => {
    vi.useFakeTimers();
    try {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2, 3]));
        },
      });
      stubRuntimeFetch(
        vi.fn(
          async () =>
            new Response(stream, {
              status: 200,
            }),
        ),
      );

      const requestPromise = performMatrixRequest({
        homeserver: "http://127.0.0.1:8008",
        accessToken: "token",
        method: "GET",
        endpoint: "/_matrix/media/v3/download/example/id",
        timeoutMs: 5000,
        raw: true,
        maxBytes: 1024,
        readIdleTimeoutMs: 50,
        ssrfPolicy: { allowPrivateNetwork: true },
      });

      const rejection = expect(requestPromise).rejects.toThrow(
        "Matrix media download stalled: no data received for 50ms",
      );
      await vi.advanceTimersByTimeAsync(60);
      await rejection;
    } finally {
      vi.useRealTimers();
    }
  }, 5_000);

  it("normalizes Matrix request timeout aborts without leaking query params", async () => {
    vi.useFakeTimers();
    try {
      stubRuntimeFetch(
        vi.fn(
          async (_input: RequestInfo | URL, init?: RequestInit) =>
            await new Promise<Response>((_resolve, reject) => {
              const signal = init?.signal;
              const rejectAbort = () =>
                reject(new DOMException("This operation was aborted", "AbortError"));
              if (signal?.aborted) {
                rejectAbort();
                return;
              }
              signal?.addEventListener("abort", rejectAbort, { once: true });
            }),
        ),
      );

      const requestPromise = performMatrixRequest({
        homeserver: "http://127.0.0.1:8008",
        accessToken: "token",
        method: "GET",
        endpoint: "/_matrix/client/v3/account/whoami",
        qs: { access_token: "secret" },
        timeoutMs: 50,
        ssrfPolicy: { allowPrivateNetwork: true },
      });

      const rejection = expect(requestPromise).rejects.toMatchObject({
        name: "AbortError",
        message:
          "Matrix request timed out after 50ms: http://127.0.0.1:8008/_matrix/client/v3/account/whoami",
      });
      await vi.advanceTimersByTimeAsync(60);
      await rejection;
    } finally {
      vi.useRealTimers();
    }
  }, 5_000);

  it("normalizes Matrix SDK aborts without misclassifying them as generic fetch errors", async () => {
    const abortController = new AbortController();
    abortController.abort();
    stubRuntimeFetch(
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        expect(init?.signal?.aborted).toBe(true);
        throw new DOMException("This operation was aborted", "AbortError");
      }),
    );

    const guardedFetch = createMatrixGuardedFetch({
      ssrfPolicy: { allowPrivateNetwork: true },
    });

    await expect(
      guardedFetch("http://127.0.0.1:8008/_matrix/client/v3/sync?access_token=secret", {
        signal: abortController.signal,
      }),
    ).rejects.toMatchObject({
      name: "AbortError",
      message:
        "Matrix request aborted before completion: http://127.0.0.1:8008/_matrix/client/v3/sync",
    });
  });

  it("uses undici runtime fetch for pinned Matrix requests so the dispatcher stays bound", async () => {
    let ambientFetchCalls = 0;
    vi.stubGlobal("fetch", (async () => {
      ambientFetchCalls += 1;
      throw new Error("expected pinned Matrix requests to avoid ambient fetch");
    }) as typeof fetch);
    const runtimeFetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const requestInit = init as RequestInit & { dispatcher?: unknown };
      expect(requestInit.dispatcher).toBeDefined();
      return new Response('{"ok":true}', {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      });
    });
    stubRuntimeFetch(runtimeFetch);

    const result = await performMatrixRequest({
      homeserver: "http://127.0.0.1:8008",
      accessToken: "token",
      method: "GET",
      endpoint: "/_matrix/client/v3/account/whoami",
      timeoutMs: 5000,
      ssrfPolicy: { allowPrivateNetwork: true },
    });

    expect(result.text).toBe('{"ok":true}');
    expect(ambientFetchCalls).toBe(0);
    expect(runtimeFetch).toHaveBeenCalledTimes(1);
    expect(
      (runtimeFetch.mock.calls[0]?.[1] as RequestInit & { dispatcher?: unknown })?.dispatcher,
    ).toBeDefined();
  });
});
