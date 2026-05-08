import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { resolveStateDir } from "../config/paths.js";
import { approveDevicePairing, requestDevicePairing } from "../infra/device-pairing.js";
import { resolvePreferredGenesisTmpDir } from "../infra/tmp-genesis-dir.js";
import { MAX_DOCUMENT_BYTES } from "../media/constants.js";
import type { ResolvedGatewayAuth } from "./auth.js";
import { CONTROL_UI_BOOTSTRAP_CONFIG_PATH } from "./control-ui-contract.js";
import {
  handleControlUiAssistantMediaRequest,
  handleControlUiAvatarRequest,
  handleControlUiCanvasUploadRequest,
  handleControlUiHttpRequest,
} from "./control-ui.js";
import { makeMockHttpResponse } from "./test-http-response.js";

describe("handleControlUiHttpRequest", () => {
  async function withControlUiRoot<T>(params: {
    indexHtml?: string;
    fn: (tmp: string) => Promise<T>;
  }) {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "genesis-ui-"));
    try {
      await fs.writeFile(path.join(tmp, "index.html"), params.indexHtml ?? "<html></html>\n");
      return await params.fn(tmp);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  }

  function parseBootstrapPayload(end: ReturnType<typeof makeMockHttpResponse>["end"]) {
    return JSON.parse(String(end.mock.calls[0]?.[0] ?? "")) as {
      basePath: string;
      assistantName: string;
      assistantAvatar: string;
      assistantAgentId: string;
      localMediaPreviewRoots?: string[];
    };
  }

  function expectNotFoundResponse(params: {
    handled: boolean;
    res: ReturnType<typeof makeMockHttpResponse>["res"];
    end: ReturnType<typeof makeMockHttpResponse>["end"];
  }) {
    expect(params.handled).toBe(true);
    expect(params.res.statusCode).toBe(404);
    expect(params.end).toHaveBeenCalledWith("Not Found");
  }

  async function runControlUiRequest(params: {
    url: string;
    method: "GET" | "HEAD" | "POST";
    rootPath: string;
    basePath?: string;
    rootKind?: "resolved" | "bundled";
    getReadiness?: () => { ready: boolean; failing: string[]; uptimeMs: number };
  }) {
    const { res, end } = makeMockHttpResponse();
    const handled = await handleControlUiHttpRequest(
      { url: params.url, method: params.method } as IncomingMessage,
      res,
      {
        ...(params.basePath ? { basePath: params.basePath } : {}),
        root: { kind: params.rootKind ?? "resolved", path: params.rootPath },
        getReadiness: params.getReadiness,
      },
    );
    return { res, end, handled };
  }

  async function runBootstrapConfigRequest(params: {
    rootPath: string;
    basePath?: string;
    auth?: ResolvedGatewayAuth;
    headers?: IncomingMessage["headers"];
  }) {
    const { res, end } = makeMockHttpResponse();
    const url = params.basePath
      ? `${params.basePath}${CONTROL_UI_BOOTSTRAP_CONFIG_PATH}`
      : CONTROL_UI_BOOTSTRAP_CONFIG_PATH;
    const handled = await handleControlUiHttpRequest(
      {
        url,
        method: "GET",
        headers: params.headers ?? {},
        socket: { remoteAddress: "127.0.0.1" },
      } as IncomingMessage,
      res,
      {
        ...(params.basePath ? { basePath: params.basePath } : {}),
        ...(params.auth ? { auth: params.auth } : {}),
        root: { kind: "resolved", path: params.rootPath },
      },
    );
    return { res, end, handled };
  }

  async function runAvatarRequest(params: {
    url: string;
    method: "GET" | "HEAD";
    resolveAvatar: Parameters<typeof handleControlUiAvatarRequest>[2]["resolveAvatar"];
    basePath?: string;
    auth?: ResolvedGatewayAuth;
    headers?: IncomingMessage["headers"];
    trustedProxies?: string[];
    remoteAddress?: string;
  }) {
    const { res, end } = makeMockHttpResponse();
    const handled = await handleControlUiAvatarRequest(
      {
        url: params.url,
        method: params.method,
        headers: params.headers ?? {},
        socket: { remoteAddress: params.remoteAddress ?? "127.0.0.1" },
      } as IncomingMessage,
      res,
      {
        ...(params.basePath ? { basePath: params.basePath } : {}),
        ...(params.auth ? { auth: params.auth } : {}),
        ...(params.trustedProxies ? { trustedProxies: params.trustedProxies } : {}),
        resolveAvatar: params.resolveAvatar,
      },
    );
    return { res, end, handled };
  }

  async function runAssistantMediaRequest(params: {
    url: string;
    method: "GET" | "HEAD";
    basePath?: string;
    auth?: ResolvedGatewayAuth;
    headers?: IncomingMessage["headers"];
    trustedProxies?: string[];
    remoteAddress?: string;
  }) {
    const { res, end } = makeMockHttpResponse();
    const handled = await handleControlUiAssistantMediaRequest(
      {
        url: params.url,
        method: params.method,
        headers: params.headers ?? {},
        socket: { remoteAddress: params.remoteAddress ?? "127.0.0.1" },
      } as IncomingMessage,
      res,
      {
        ...(params.basePath ? { basePath: params.basePath } : {}),
        ...(params.auth ? { auth: params.auth } : {}),
        ...(params.trustedProxies ? { trustedProxies: params.trustedProxies } : {}),
      },
    );
    return { res, end, handled };
  }

  async function runCanvasUploadRequest(params: {
    url?: string;
    method?: "GET" | "POST";
    body?: Buffer | string;
    basePath?: string;
    auth?: ResolvedGatewayAuth;
    headers?: IncomingMessage["headers"];
    trustedProxies?: string[];
    remoteAddress?: string;
    canvasRoot?: string;
    canvasEnabled?: boolean;
  }) {
    const { res, end } = makeMockHttpResponse();
    const req = Readable.from(params.body === undefined ? [] : [params.body]) as IncomingMessage;
    Object.assign(req, {
      url: params.url ?? "/__genesis__/canvas-upload?mode=create",
      method: params.method ?? "POST",
      headers: params.headers ?? {},
      socket: { remoteAddress: params.remoteAddress ?? "127.0.0.1" },
    });
    const handled = await handleControlUiCanvasUploadRequest(req, res, {
      ...(params.basePath ? { basePath: params.basePath } : {}),
      ...(params.auth ? { auth: params.auth } : {}),
      ...(params.trustedProxies ? { trustedProxies: params.trustedProxies } : {}),
      config: {
        canvasHost: {
          ...(params.canvasRoot ? { root: params.canvasRoot } : {}),
          ...(params.canvasEnabled === false ? { enabled: false } : {}),
        },
      },
    });
    return { res, end, handled };
  }

  async function listCanvasUploadTempDirs(): Promise<string[]> {
    const entries = await fs.readdir(os.tmpdir(), { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory() && entry.name.startsWith("genesis-canvas-upload-"))
      .map((entry) => path.join(os.tmpdir(), entry.name))
      .toSorted();
  }

  function createTrustedProxyAuth(): ResolvedGatewayAuth {
    return {
      mode: "trusted-proxy",
      allowTailscale: false,
      trustedProxy: {
        userHeader: "x-forwarded-user",
      },
    };
  }

  function createTrustedProxyHeaders(
    extraHeaders: IncomingMessage["headers"] = {},
  ): IncomingMessage["headers"] {
    return {
      host: "gateway.example.com",
      "x-forwarded-user": "nick@example.com",
      "x-forwarded-proto": "https",
      ...extraHeaders,
    };
  }

  async function runTrustedProxyAssistantMediaRequest(params: {
    filePath: string;
    meta?: boolean;
    headers?: IncomingMessage["headers"];
  }) {
    return await runAssistantMediaRequest({
      url: `/__genesis__/assistant-media?${params.meta ? "meta=1&" : ""}source=${encodeURIComponent(params.filePath)}`,
      method: "GET",
      auth: createTrustedProxyAuth(),
      trustedProxies: ["10.0.0.1"],
      remoteAddress: "10.0.0.1",
      headers: createTrustedProxyHeaders(params.headers),
    });
  }

  async function runTrustedProxyAvatarRequest(params: {
    agentId?: string;
    meta?: boolean;
    headers?: IncomingMessage["headers"];
    resolveAvatar?: Parameters<typeof handleControlUiAvatarRequest>[2]["resolveAvatar"];
  }) {
    return await runAvatarRequest({
      url: `/avatar/${params.agentId ?? "main"}${params.meta ? "?meta=1" : ""}`,
      method: "GET",
      auth: createTrustedProxyAuth(),
      trustedProxies: ["10.0.0.1"],
      remoteAddress: "10.0.0.1",
      headers: createTrustedProxyHeaders(params.headers),
      resolveAvatar:
        params.resolveAvatar ?? (() => ({ kind: "remote", url: "https://example.com/avatar.png" })),
    });
  }

  function expectMissingOperatorReadResponse(params: {
    handled: boolean;
    res: ReturnType<typeof makeMockHttpResponse>["res"];
    end: ReturnType<typeof makeMockHttpResponse>["end"];
  }) {
    expect(params.handled).toBe(true);
    expect(params.res.statusCode).toBe(403);
    expect(JSON.parse(String(params.end.mock.calls[0]?.[0] ?? ""))).toMatchObject({
      ok: false,
      error: {
        type: "forbidden",
        message: "missing scope: operator.read",
      },
    });
  }

  async function writeAssetFile(rootPath: string, filename: string, contents: string) {
    const assetsDir = path.join(rootPath, "assets");
    await fs.mkdir(assetsDir, { recursive: true });
    const filePath = path.join(assetsDir, filename);
    await fs.writeFile(filePath, contents);
    return { assetsDir, filePath };
  }

  async function createHardlinkedAssetFile(rootPath: string) {
    const { filePath } = await writeAssetFile(rootPath, "app.js", "console.log('hi');");
    const hardlinkPath = path.join(path.dirname(filePath), "app.hl.js");
    await fs.link(filePath, hardlinkPath);
    return hardlinkPath;
  }

  async function withAllowedAssistantMediaRoot<T>(params: {
    prefix: string;
    fn: (tmpRoot: string) => Promise<T>;
  }) {
    const tmpRoot = await fs.mkdtemp(path.join(resolvePreferredGenesisTmpDir(), params.prefix));
    try {
      return await params.fn(tmpRoot);
    } finally {
      await fs.rm(tmpRoot, { recursive: true, force: true });
    }
  }

  async function withBasePathRootFixture<T>(params: {
    siblingDir: string;
    fn: (paths: { root: string; sibling: string }) => Promise<T>;
  }) {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "genesis-ui-root-"));
    try {
      const root = path.join(tmp, "ui");
      const sibling = path.join(tmp, params.siblingDir);
      await fs.mkdir(root, { recursive: true });
      await fs.mkdir(sibling, { recursive: true });
      await fs.writeFile(path.join(root, "index.html"), "<html>ok</html>\n");
      return await params.fn({ root, sibling });
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  }

  async function withPairedOperatorDeviceToken<T>(params: {
    scopes?: string[];
    fn: (token: string) => Promise<T>;
  }) {
    const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), "genesis-ui-device-token-"));
    vi.stubEnv("GENESIS_HOME", tempHome);
    try {
      const scopes = params.scopes ?? ["operator.read"];
      const deviceId = "control-ui-device";
      const requested = await requestDevicePairing({
        deviceId,
        publicKey: "test-public-key",
        role: "operator",
        scopes,
        clientId: "genesis-control-ui",
        clientMode: "webchat",
      });
      const approved = await approveDevicePairing(requested.request.requestId, {
        callerScopes: scopes,
      });
      expect(approved?.status).toBe("approved");
      const operatorToken =
        approved?.status === "approved" ? approved.device.tokens?.operator?.token : undefined;
      expect(typeof operatorToken).toBe("string");
      return await params.fn(operatorToken ?? "");
    } finally {
      vi.unstubAllEnvs();
      await fs.rm(tempHome, { recursive: true, force: true });
    }
  }

  it("creates hosted Canvas documents from Control UI uploads", async () => {
    const canvasRoot = await fs.mkdtemp(path.join(os.tmpdir(), "genesis-canvas-upload-root-"));
    try {
      const { res, handled, end } = await runCanvasUploadRequest({
        canvasRoot,
        body: "<h1>hello</h1>",
        headers: {
          "x-genesis-file-name": "hello.html",
          "content-type": "text/html",
        },
      });

      expect(handled).toBe(true);
      expect(res.statusCode).toBe(200);
      const payload = JSON.parse(String(end.mock.calls[0]?.[0] ?? "")) as {
        ok: boolean;
        document: { id: string; entryUrl: string; revision: number; sourceFileName?: string };
      };
      expect(payload.ok).toBe(true);
      expect(payload.document.revision).toBe(1);
      expect(payload.document.sourceFileName).toBe("hello.html");
      expect(payload.document.entryUrl).toContain(
        `/__genesis__/canvas/documents/${payload.document.id}/`,
      );
      await expect(
        fs.stat(path.join(canvasRoot, "documents", payload.document.id, "manifest.json")),
      ).resolves.toBeTruthy();
    } finally {
      await fs.rm(canvasRoot, { recursive: true, force: true });
    }
  });

  it("updates hosted Canvas documents from Control UI uploads", async () => {
    const canvasRoot = await fs.mkdtemp(path.join(os.tmpdir(), "genesis-canvas-upload-root-"));
    try {
      const first = await runCanvasUploadRequest({
        canvasRoot,
        body: "<h1>first</h1>",
        headers: {
          "x-genesis-file-name": "first.html",
          "content-type": "text/html",
        },
      });
      const created = JSON.parse(String(first.end.mock.calls[0]?.[0] ?? "")) as {
        document: { id: string };
      };

      const second = await runCanvasUploadRequest({
        canvasRoot,
        url: `/__genesis__/canvas-upload?mode=update&id=${created.document.id}`,
        body: "<h1>second</h1>",
        headers: {
          "x-genesis-file-name": "second.html",
          "content-type": "text/html",
        },
      });

      expect(second.handled).toBe(true);
      expect(second.res.statusCode).toBe(200);
      const updated = JSON.parse(String(second.end.mock.calls[0]?.[0] ?? "")) as {
        document: { id: string; revision: number; sourceFileName?: string };
      };
      expect(updated.document.id).toBe(created.document.id);
      expect(updated.document.revision).toBe(2);
      expect(updated.document.sourceFileName).toBe("second.html");
    } finally {
      await fs.rm(canvasRoot, { recursive: true, force: true });
    }
  });

  it("accepts paired operator write device tokens for Canvas uploads", async () => {
    await withPairedOperatorDeviceToken({
      scopes: ["operator.write"],
      fn: async (operatorToken) => {
        const canvasRoot = await fs.mkdtemp(path.join(os.tmpdir(), "genesis-canvas-upload-root-"));
        try {
          const { res, handled } = await runCanvasUploadRequest({
            canvasRoot,
            auth: { mode: "token", token: "shared-token", allowTailscale: false },
            body: "<h1>hello</h1>",
            headers: {
              authorization: `Bearer ${operatorToken}`,
              "x-genesis-file-name": "hello.html",
              "content-type": "text/html",
            },
          });

          expect(handled).toBe(true);
          expect(res.statusCode).toBe(200);
        } finally {
          await fs.rm(canvasRoot, { recursive: true, force: true });
        }
      },
    });
  });

  it("rejects trusted-proxy Canvas uploads without operator.write scope", async () => {
    const { res, handled, end } = await runCanvasUploadRequest({
      auth: createTrustedProxyAuth(),
      trustedProxies: ["10.0.0.1"],
      remoteAddress: "10.0.0.1",
      body: "<h1>hello</h1>",
      headers: createTrustedProxyHeaders({
        "x-genesis-scopes": "operator.read",
        "x-genesis-file-name": "hello.html",
        "content-type": "text/html",
      }),
    });

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(String(end.mock.calls[0]?.[0] ?? ""))).toMatchObject({
      ok: false,
      error: {
        type: "forbidden",
        message: "missing scope: operator.write",
      },
    });
  });

  it("rejects Canvas uploads when the canvas host is disabled", async () => {
    const { res, handled, end } = await runCanvasUploadRequest({
      canvasEnabled: false,
      body: "<h1>hello</h1>",
      headers: {
        "x-genesis-file-name": "hello.html",
      },
    });

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(503);
    expect(JSON.parse(String(end.mock.calls[0]?.[0] ?? ""))).toMatchObject({
      ok: false,
      error: { type: "unavailable" },
    });
  });

  it("rejects oversized Canvas uploads before writing a temp file", async () => {
    const before = await listCanvasUploadTempDirs();
    const { res, handled, end } = await runCanvasUploadRequest({
      body: "",
      headers: {
        "x-genesis-file-name": "huge.html",
        "content-length": String(MAX_DOCUMENT_BYTES + 1),
      },
    });

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(413);
    expect(JSON.parse(String(end.mock.calls[0]?.[0] ?? ""))).toMatchObject({
      ok: false,
      error: { type: "payload_too_large" },
    });
    await expect(listCanvasUploadTempDirs()).resolves.toEqual(before);
  });

  it("rejects Canvas uploads without a filename or body and cleans temp files", async () => {
    const missingName = await runCanvasUploadRequest({ body: "<h1>hello</h1>" });
    expect(missingName.handled).toBe(true);
    expect(missingName.res.statusCode).toBe(400);

    const before = await listCanvasUploadTempDirs();
    const emptyBody = await runCanvasUploadRequest({
      headers: {
        "x-genesis-file-name": "empty.html",
      },
    });

    expect(emptyBody.handled).toBe(true);
    expect(emptyBody.res.statusCode).toBe(400);
    expect(JSON.parse(String(emptyBody.end.mock.calls[0]?.[0] ?? ""))).toMatchObject({
      ok: false,
      error: { type: "invalid_request_error" },
    });
    await expect(listCanvasUploadTempDirs()).resolves.toEqual(before);
  });

  it("sets security headers for Control UI responses", async () => {
    await withControlUiRoot({
      fn: async (tmp) => {
        const { res, setHeader } = makeMockHttpResponse();
        const handled = await handleControlUiHttpRequest(
          { url: "/", method: "GET" } as IncomingMessage,
          res,
          {
            root: { kind: "resolved", path: tmp },
          },
        );
        expect(handled).toBe(true);
        expect(setHeader).toHaveBeenCalledWith("X-Frame-Options", "DENY");
        const csp = setHeader.mock.calls.find((call) => call[0] === "Content-Security-Policy")?.[1];
        expect(typeof csp).toBe("string");
        expect(String(csp)).toContain("frame-ancestors 'none'");
        expect(String(csp)).toContain("script-src 'self'");
        expect(String(csp)).not.toContain("script-src 'self' 'unsafe-inline'");
      },
    });
  });

  it("serves assistant local media through the control ui media route", async () => {
    await withAllowedAssistantMediaRoot({
      prefix: "ui-media-",
      fn: async (tmpRoot) => {
        const filePath = path.join(tmpRoot, "photo.png");
        await fs.writeFile(filePath, Buffer.from("not-a-real-png"));
        const { res, handled } = await runAssistantMediaRequest({
          url: `/__genesis__/assistant-media?source=${encodeURIComponent(filePath)}&token=test-token`,
          method: "GET",
          auth: { mode: "token", token: "test-token", allowTailscale: false },
        });
        expect(handled).toBe(true);
        expect(res.statusCode).toBe(200);
      },
    });
  });

  it("serves assistant media from canonical inbound media refs", async () => {
    const stateDir = resolveStateDir();
    const id = `ui-media-ref-${Date.now()}-${Math.random().toString(36).slice(2)}.png`;
    const filePath = path.join(stateDir, "media", "inbound", id);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, Buffer.from("not-a-real-png"));

    try {
      const { res, handled } = await runAssistantMediaRequest({
        url: `/__genesis__/assistant-media?source=${encodeURIComponent(`media://inbound/${id}`)}&token=test-token`,
        method: "GET",
        auth: { mode: "token", token: "test-token", allowTailscale: false },
      });
      expect(handled).toBe(true);
      expect(res.statusCode).toBe(200);
    } finally {
      await fs.rm(filePath, { force: true });
    }
  });

  it("reports assistant media metadata for canonical inbound media refs", async () => {
    const stateDir = resolveStateDir();
    const id = `ui-media-ref-meta-${Date.now()}-${Math.random().toString(36).slice(2)}.png`;
    const filePath = path.join(stateDir, "media", "inbound", id);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, Buffer.from("not-a-real-png"));

    try {
      const { res, handled, end } = await runAssistantMediaRequest({
        url: `/__genesis__/assistant-media?meta=1&source=${encodeURIComponent(`media://inbound/${id}`)}&token=test-token`,
        method: "GET",
        auth: { mode: "token", token: "test-token", allowTailscale: false },
      });
      expect(handled).toBe(true);
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(String(end.mock.calls[0]?.[0] ?? ""))).toEqual({ available: true });
    } finally {
      await fs.rm(filePath, { force: true });
    }
  });

  it("rejects assistant local media outside allowed preview roots", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "genesis-ui-media-blocked-"));
    try {
      const filePath = path.join(tmp, "photo.png");
      await fs.writeFile(filePath, Buffer.from("not-a-real-png"));
      const { res, handled, end } = await runAssistantMediaRequest({
        url: `/__genesis__/assistant-media?source=${encodeURIComponent(filePath)}&token=test-token`,
        method: "GET",
        auth: { mode: "token", token: "test-token", allowTailscale: false },
      });
      expectNotFoundResponse({ handled, res, end });
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it("reports assistant local media availability metadata", async () => {
    await withAllowedAssistantMediaRoot({
      prefix: "ui-media-meta-",
      fn: async (tmpRoot) => {
        const filePath = path.join(tmpRoot, "photo.png");
        await fs.writeFile(filePath, Buffer.from("not-a-real-png"));
        const { res, handled, end } = await runAssistantMediaRequest({
          url: `/__genesis__/assistant-media?meta=1&source=${encodeURIComponent(filePath)}&token=test-token`,
          method: "GET",
          auth: { mode: "token", token: "test-token", allowTailscale: false },
        });
        expect(handled).toBe(true);
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(String(end.mock.calls[0]?.[0] ?? ""))).toEqual({ available: true });
      },
    });
  });

  it("reports assistant local media availability failures with a reason", async () => {
    const { res, handled, end } = await runAssistantMediaRequest({
      url: `/__genesis__/assistant-media?meta=1&source=${encodeURIComponent("/Users/test/Documents/private.pdf")}&token=test-token`,
      method: "GET",
      auth: { mode: "token", token: "test-token", allowTailscale: false },
    });
    expect(handled).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(String(end.mock.calls[0]?.[0] ?? ""))).toEqual({
      available: false,
      code: "outside-allowed-folders",
      reason: "Outside allowed folders",
    });
  });

  it("rejects assistant local media without a valid auth token when auth is enabled", async () => {
    await withAllowedAssistantMediaRoot({
      prefix: "ui-media-auth-",
      fn: async (tmpRoot) => {
        const filePath = path.join(tmpRoot, "photo.png");
        await fs.writeFile(filePath, Buffer.from("not-a-real-png"));
        const { res, handled, end } = await runAssistantMediaRequest({
          url: `/__genesis__/assistant-media?source=${encodeURIComponent(filePath)}`,
          method: "GET",
          auth: { mode: "token", token: "test-token", allowTailscale: false },
        });
        expect(handled).toBe(true);
        expect(res.statusCode).toBe(401);
        expect(String(end.mock.calls[0]?.[0] ?? "")).toContain("Unauthorized");
      },
    });
  });

  it("accepts paired operator device tokens on assistant media requests", async () => {
    await withPairedOperatorDeviceToken({
      fn: async (operatorToken) => {
        await withAllowedAssistantMediaRoot({
          prefix: "ui-media-device-token-",
          fn: async (tmpRoot) => {
            const filePath = path.join(tmpRoot, "photo.png");
            await fs.writeFile(filePath, Buffer.from("not-a-real-png"));
            const { res, handled } = await runAssistantMediaRequest({
              url: `/__genesis__/assistant-media?source=${encodeURIComponent(filePath)}`,
              method: "GET",
              auth: { mode: "token", token: "shared-token", allowTailscale: false },
              headers: {
                authorization: `Bearer ${operatorToken}`,
              },
            });
            expect(handled).toBe(true);
            expect(res.statusCode).toBe(200);
          },
        });
      },
    });
  });

  it("accepts paired operator device tokens in assistant media query auth", async () => {
    await withPairedOperatorDeviceToken({
      fn: async (operatorToken) => {
        await withAllowedAssistantMediaRoot({
          prefix: "ui-media-device-token-query-",
          fn: async (tmpRoot) => {
            const filePath = path.join(tmpRoot, "photo.png");
            await fs.writeFile(filePath, Buffer.from("not-a-real-png"));
            const { res, handled } = await runAssistantMediaRequest({
              url: `/__genesis__/assistant-media?source=${encodeURIComponent(filePath)}&token=${encodeURIComponent(operatorToken)}`,
              method: "GET",
              auth: { mode: "token", token: "shared-token", allowTailscale: false },
            });
            expect(handled).toBe(true);
            expect(res.statusCode).toBe(200);
          },
        });
      },
    });
  });

  it("rejects trusted-proxy assistant media requests from disallowed browser origins", async () => {
    await withAllowedAssistantMediaRoot({
      prefix: "ui-media-proxy-",
      fn: async (tmpRoot) => {
        const filePath = path.join(tmpRoot, "photo.png");
        await fs.writeFile(filePath, Buffer.from("not-a-real-png"));
        const { res, handled, end } = await runTrustedProxyAssistantMediaRequest({
          filePath,
          headers: {
            origin: "https://evil.example",
          },
        });
        expect(handled).toBe(true);
        expect(res.statusCode).toBe(401);
        expect(String(end.mock.calls[0]?.[0] ?? "")).toContain("Unauthorized");
      },
    });
  });

  it("rejects trusted-proxy assistant media file reads without operator.read scope", async () => {
    await withAllowedAssistantMediaRoot({
      prefix: "ui-media-scope-file-",
      fn: async (tmpRoot) => {
        const filePath = path.join(tmpRoot, "photo.png");
        await fs.writeFile(filePath, Buffer.from("not-a-real-png"));
        const { res, handled, end } = await runTrustedProxyAssistantMediaRequest({
          filePath,
          headers: {
            "x-genesis-scopes": "operator.approvals",
          },
        });
        expectMissingOperatorReadResponse({ handled, res, end });
      },
    });
  });

  it("rejects trusted-proxy assistant media metadata requests with an empty scope set", async () => {
    await withAllowedAssistantMediaRoot({
      prefix: "ui-media-scope-meta-",
      fn: async (tmpRoot) => {
        const filePath = path.join(tmpRoot, "photo.png");
        await fs.writeFile(filePath, Buffer.from("not-a-real-png"));
        const { res, handled, end } = await runTrustedProxyAssistantMediaRequest({
          filePath,
          meta: true,
          headers: {
            "x-genesis-scopes": "",
          },
        });
        expectMissingOperatorReadResponse({ handled, res, end });
      },
    });
  });

  it("includes CSP hash for inline scripts in index.html", async () => {
    const scriptContent = "(function(){ var x = 1; })();";
    const html = `<html><head><script>${scriptContent}</script></head><body></body></html>\n`;
    const expectedHash = createHash("sha256").update(scriptContent, "utf8").digest("base64");
    await withControlUiRoot({
      indexHtml: html,
      fn: async (tmp) => {
        const { res, setHeader } = makeMockHttpResponse();
        await handleControlUiHttpRequest({ url: "/", method: "GET" } as IncomingMessage, res, {
          root: { kind: "resolved", path: tmp },
        });
        const cspCalls = setHeader.mock.calls.filter(
          (call) => call[0] === "Content-Security-Policy",
        );
        const lastCsp = String(cspCalls[cspCalls.length - 1]?.[1] ?? "");
        expect(lastCsp).toContain(`'sha256-${expectedHash}'`);
        expect(lastCsp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
      },
    });
  });

  it("does not inject inline scripts into index.html", async () => {
    const html = "<html><head></head><body>Hello</body></html>\n";
    await withControlUiRoot({
      indexHtml: html,
      fn: async (tmp) => {
        const { res, end } = makeMockHttpResponse();
        const handled = await handleControlUiHttpRequest(
          { url: "/", method: "GET" } as IncomingMessage,
          res,
          {
            root: { kind: "resolved", path: tmp },
            config: {
              agents: { defaults: { workspace: tmp } },
              ui: { assistant: { name: "</script><script>alert(1)//", avatar: "evil.png" } },
            },
          },
        );
        expect(handled).toBe(true);
        expect(end).toHaveBeenCalledWith(html);
      },
    });
  });

  it("serves bootstrap config JSON", async () => {
    await withControlUiRoot({
      fn: async (tmp) => {
        const { res, end } = makeMockHttpResponse();
        const handled = await handleControlUiHttpRequest(
          { url: CONTROL_UI_BOOTSTRAP_CONFIG_PATH, method: "GET" } as IncomingMessage,
          res,
          {
            root: { kind: "resolved", path: tmp },
            config: {
              agents: { defaults: { workspace: tmp } },
              ui: { assistant: { name: "</script><script>alert(1)//", avatar: "</script>.png" } },
            },
          },
        );
        expect(handled).toBe(true);
        const parsed = parseBootstrapPayload(end);
        expect(parsed.basePath).toBe("");
        expect(parsed.assistantName).toBe("</script><script>alert(1)//");
        expect(parsed.assistantAvatar).toBe("/avatar/main");
        expect(parsed.assistantAgentId).toBe("main");
        expect(Array.isArray(parsed.localMediaPreviewRoots)).toBe(true);
      },
    });
  });

  it("rejects bootstrap config requests without a valid auth token when auth is enabled", async () => {
    await withControlUiRoot({
      fn: async (tmp) => {
        const { res, handled, end } = await runBootstrapConfigRequest({
          rootPath: tmp,
          auth: { mode: "token", token: "test-token", allowTailscale: false },
        });
        expect(handled).toBe(true);
        expect(res.statusCode).toBe(401);
        expect(String(end.mock.calls[0]?.[0] ?? "")).toContain("Unauthorized");
      },
    });
  });

  it("serves bootstrap config JSON when auth is enabled and the token is valid", async () => {
    await withControlUiRoot({
      fn: async (tmp) => {
        const { res, handled, end } = await runBootstrapConfigRequest({
          rootPath: tmp,
          auth: { mode: "token", token: "test-token", allowTailscale: false },
          headers: {
            authorization: "Bearer test-token",
          },
        });
        expect(handled).toBe(true);
        expect(res.statusCode).toBe(200);
        const parsed = parseBootstrapPayload(end);
        expect(parsed.assistantAgentId).toBe("main");
      },
    });
  });

  it("serves bootstrap config JSON when paired device-token auth is valid", async () => {
    await withPairedOperatorDeviceToken({
      fn: async (operatorToken) => {
        await withControlUiRoot({
          fn: async (tmp) => {
            const { res, handled, end } = await runBootstrapConfigRequest({
              rootPath: tmp,
              auth: { mode: "token", token: "shared-token", allowTailscale: false },
              headers: {
                authorization: `Bearer ${operatorToken}`,
              },
            });
            expect(handled).toBe(true);
            expect(res.statusCode).toBe(200);
            const parsed = parseBootstrapPayload(end);
            expect(parsed.assistantAgentId).toBe("main");
          },
        });
      },
    });
  });

  it("serves bootstrap config JSON under basePath", async () => {
    await withControlUiRoot({
      fn: async (tmp) => {
        const { res, end } = makeMockHttpResponse();
        const handled = await handleControlUiHttpRequest(
          { url: `/genesis${CONTROL_UI_BOOTSTRAP_CONFIG_PATH}`, method: "GET" } as IncomingMessage,
          res,
          {
            basePath: "/genesis",
            root: { kind: "resolved", path: tmp },
            config: {
              agents: { defaults: { workspace: tmp } },
              ui: { assistant: { name: "Ops", avatar: "ops.png" } },
            },
          },
        );
        expect(handled).toBe(true);
        const parsed = parseBootstrapPayload(end);
        expect(parsed.basePath).toBe("/genesis");
        expect(parsed.assistantName).toBe("Ops");
        expect(parsed.assistantAvatar).toBe("/genesis/avatar/main");
        expect(parsed.assistantAgentId).toBe("main");
        expect(Array.isArray(parsed.localMediaPreviewRoots)).toBe(true);
      },
    });
  });

  it("returns startup 503 for Control UI routes while startup sidecars are pending", async () => {
    await withControlUiRoot({
      fn: async (tmp) => {
        const { res, end, handled } = await runControlUiRequest({
          url: "/",
          method: "GET",
          rootPath: tmp,
          getReadiness: () => ({
            ready: false,
            failing: ["startup-sidecars"],
            uptimeMs: 120,
          }),
        });

        expect(handled).toBe(true);
        expect(res.statusCode).toBe(503);
        expect(end).toHaveBeenCalledWith("Gateway is still starting; retry shortly.");
      },
    });
  });

  it("serves Control UI routes when readiness failures are not startup pending", async () => {
    await withControlUiRoot({
      fn: async (tmp) => {
        const { res, end, handled } = await runControlUiRequest({
          url: "/",
          method: "GET",
          rootPath: tmp,
          getReadiness: () => ({
            ready: false,
            failing: ["discord"],
            uptimeMs: 5_000,
          }),
        });

        expect(handled).toBe(true);
        expect(res.statusCode).toBe(200);
        expect(String(end.mock.calls[0]?.[0] ?? "")).toBe("<html></html>\n");
      },
    });
  });

  it("serves local avatar bytes through hardened avatar handler", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "genesis-avatar-http-"));
    try {
      const avatarPath = path.join(tmp, "main.png");
      await fs.writeFile(avatarPath, "avatar-bytes\n");

      const { res, end, handled } = await runAvatarRequest({
        url: "/avatar/main",
        method: "GET",
        resolveAvatar: () => ({ kind: "local", filePath: avatarPath }),
      });

      expect(handled).toBe(true);
      expect(res.statusCode).toBe(200);
      expect(String(end.mock.calls[0]?.[0] ?? "")).toBe("avatar-bytes\n");
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it("rejects avatar symlink paths from resolver", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "genesis-avatar-http-link-"));
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "genesis-avatar-http-outside-"));
    try {
      const outsideFile = path.join(outside, "secret.txt");
      await fs.writeFile(outsideFile, "outside-secret\n");
      const linkPath = path.join(tmp, "avatar-link.png");
      await fs.symlink(outsideFile, linkPath);

      const { res, end, handled } = await runAvatarRequest({
        url: "/avatar/main",
        method: "GET",
        resolveAvatar: () => ({ kind: "local", filePath: linkPath }),
      });

      expectNotFoundResponse({ handled, res, end });
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
      await fs.rm(outside, { recursive: true, force: true });
    }
  });

  it("serves local avatar bytes when auth is enabled and the token is valid", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "genesis-avatar-auth-"));
    try {
      const avatarPath = path.join(tmp, "main.png");
      await fs.writeFile(avatarPath, "avatar-bytes\n");

      const { res, handled } = await runAvatarRequest({
        url: "/avatar/main",
        method: "GET",
        auth: { mode: "token", token: "test-token", allowTailscale: false },
        headers: {
          authorization: "Bearer test-token",
        },
        resolveAvatar: () => ({ kind: "local", filePath: avatarPath }),
      });

      expect(handled).toBe(true);
      expect(res.statusCode).toBe(200);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it("serves local avatar bytes when paired device-token auth is valid", async () => {
    await withPairedOperatorDeviceToken({
      fn: async (operatorToken) => {
        const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "genesis-avatar-device-token-"));
        try {
          const avatarPath = path.join(tmp, "main.png");
          await fs.writeFile(avatarPath, "avatar-bytes\n");

          const { res, handled, end } = await runAvatarRequest({
            url: "/avatar/main",
            method: "GET",
            auth: { mode: "token", token: "shared-token", allowTailscale: false },
            headers: {
              authorization: `Bearer ${operatorToken}`,
            },
            resolveAvatar: () => ({ kind: "local", filePath: avatarPath }),
          });

          expect(handled).toBe(true);
          expect(res.statusCode).toBe(200);
          expect(String(end.mock.calls[0]?.[0] ?? "")).toBe("avatar-bytes\n");
        } finally {
          await fs.rm(tmp, { recursive: true, force: true });
        }
      },
    });
  });

  it("returns avatar metadata when auth is enabled and the token is valid", async () => {
    const { res, end, handled } = await runAvatarRequest({
      url: "/avatar/main?meta=1",
      method: "GET",
      auth: { mode: "token", token: "test-token", allowTailscale: false },
      headers: {
        authorization: "Bearer test-token",
      },
      resolveAvatar: () => ({ kind: "remote", url: "https://example.com/avatar.png" }),
    });

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(String(end.mock.calls[0]?.[0] ?? ""))).toEqual({
      avatarUrl: "https://example.com/avatar.png",
    });
  });

  it("rejects avatar requests without a valid auth token when auth is enabled", async () => {
    const { res, handled, end } = await runAvatarRequest({
      url: "/avatar/main",
      method: "GET",
      auth: { mode: "token", token: "test-token", allowTailscale: false },
      resolveAvatar: () => ({ kind: "remote", url: "https://example.com/avatar.png" }),
    });

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(401);
    expect(String(end.mock.calls[0]?.[0] ?? "")).toContain("Unauthorized");
  });

  it("rejects trusted-proxy avatar metadata requests without operator.read scope", async () => {
    const { res, handled, end } = await runTrustedProxyAvatarRequest({
      meta: true,
      headers: {
        "x-genesis-scopes": "",
      },
    });

    expectMissingOperatorReadResponse({ handled, res, end });
  });

  it("rejects symlinked assets that resolve outside control-ui root", async () => {
    await withControlUiRoot({
      fn: async (tmp) => {
        const assetsDir = path.join(tmp, "assets");
        const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), "genesis-ui-outside-"));
        try {
          const outsideFile = path.join(outsideDir, "secret.txt");
          await fs.mkdir(assetsDir, { recursive: true });
          await fs.writeFile(outsideFile, "outside-secret\n");
          await fs.symlink(outsideFile, path.join(assetsDir, "leak.txt"));

          const { res, end } = makeMockHttpResponse();
          const handled = await handleControlUiHttpRequest(
            { url: "/assets/leak.txt", method: "GET" } as IncomingMessage,
            res,
            {
              root: { kind: "resolved", path: tmp },
            },
          );
          expectNotFoundResponse({ handled, res, end });
        } finally {
          await fs.rm(outsideDir, { recursive: true, force: true });
        }
      },
    });
  });

  it("allows symlinked assets that resolve inside control-ui root", async () => {
    await withControlUiRoot({
      fn: async (tmp) => {
        const { assetsDir, filePath } = await writeAssetFile(tmp, "actual.txt", "inside-ok\n");
        await fs.symlink(filePath, path.join(assetsDir, "linked.txt"));

        const { res, end, handled } = await runControlUiRequest({
          url: "/assets/linked.txt",
          method: "GET",
          rootPath: tmp,
        });

        expect(handled).toBe(true);
        expect(res.statusCode).toBe(200);
        expect(String(end.mock.calls[0]?.[0] ?? "")).toBe("inside-ok\n");
      },
    });
  });

  it("serves HEAD for in-root assets without writing a body", async () => {
    await withControlUiRoot({
      fn: async (tmp) => {
        await writeAssetFile(tmp, "actual.txt", "inside-ok\n");

        const { res, end, handled } = await runControlUiRequest({
          url: "/assets/actual.txt",
          method: "HEAD",
          rootPath: tmp,
        });

        expect(handled).toBe(true);
        expect(res.statusCode).toBe(200);
        expect(end.mock.calls[0]?.length ?? -1).toBe(0);
      },
    });
  });

  it("rejects symlinked SPA fallback index.html outside control-ui root", async () => {
    await withControlUiRoot({
      fn: async (tmp) => {
        const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), "genesis-ui-index-outside-"));
        try {
          const outsideIndex = path.join(outsideDir, "index.html");
          await fs.writeFile(outsideIndex, "<html>outside</html>\n");
          await fs.rm(path.join(tmp, "index.html"));
          await fs.symlink(outsideIndex, path.join(tmp, "index.html"));

          const { res, end, handled } = await runControlUiRequest({
            url: "/app/route",
            method: "GET",
            rootPath: tmp,
          });
          expectNotFoundResponse({ handled, res, end });
        } finally {
          await fs.rm(outsideDir, { recursive: true, force: true });
        }
      },
    });
  });

  it("rejects hardlinked index.html for non-package control-ui roots", async () => {
    await withControlUiRoot({
      fn: async (tmp) => {
        const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), "genesis-ui-index-hardlink-"));
        try {
          const outsideIndex = path.join(outsideDir, "index.html");
          await fs.writeFile(outsideIndex, "<html>outside-hardlink</html>\n");
          await fs.rm(path.join(tmp, "index.html"));
          await fs.link(outsideIndex, path.join(tmp, "index.html"));

          const { res, end, handled } = await runControlUiRequest({
            url: "/",
            method: "GET",
            rootPath: tmp,
          });
          expectNotFoundResponse({ handled, res, end });
        } finally {
          await fs.rm(outsideDir, { recursive: true, force: true });
        }
      },
    });
  });

  it("rejects hardlinked asset files for custom/resolved roots (security boundary)", async () => {
    await withControlUiRoot({
      fn: async (tmp) => {
        await createHardlinkedAssetFile(tmp);

        const { res, end, handled } = await runControlUiRequest({
          url: "/assets/app.hl.js",
          method: "GET",
          rootPath: tmp,
        });

        expect(handled).toBe(true);
        expect(res.statusCode).toBe(404);
        expect(end).toHaveBeenCalledWith("Not Found");
      },
    });
  });

  it("serves hardlinked asset files for bundled roots (pnpm global install)", async () => {
    await withControlUiRoot({
      fn: async (tmp) => {
        await createHardlinkedAssetFile(tmp);

        const { res, end, handled } = await runControlUiRequest({
          url: "/assets/app.hl.js",
          method: "GET",
          rootPath: tmp,
          rootKind: "bundled",
        });

        expect(handled).toBe(true);
        expect(res.statusCode).toBe(200);
        expect(String(end.mock.calls[0]?.[0] ?? "")).toBe("console.log('hi');");
      },
    });
  });

  it("does not handle POST to root-mounted paths (plugin webhook passthrough)", async () => {
    await withControlUiRoot({
      fn: async (tmp) => {
        for (const webhookPath of ["/bluebubbles-webhook", "/custom-webhook", "/callback"]) {
          const { res } = makeMockHttpResponse();
          const handled = await handleControlUiHttpRequest(
            { url: webhookPath, method: "POST" } as IncomingMessage,
            res,
            { root: { kind: "resolved", path: tmp } },
          );
          expect(handled, `POST to ${webhookPath} should pass through to plugin handlers`).toBe(
            false,
          );
        }
      },
    });
  });

  it("does not handle POST to paths outside basePath", async () => {
    await withControlUiRoot({
      fn: async (tmp) => {
        const { res } = makeMockHttpResponse();
        const handled = await handleControlUiHttpRequest(
          { url: "/bluebubbles-webhook", method: "POST" } as IncomingMessage,
          res,
          { basePath: "/genesis", root: { kind: "resolved", path: tmp } },
        );
        expect(handled).toBe(false);
      },
    });
  });

  it("does not handle /api paths when basePath is empty", async () => {
    await withControlUiRoot({
      fn: async (tmp) => {
        for (const apiPath of ["/api", "/api/sessions", "/api/channels/nostr"]) {
          const { handled } = await runControlUiRequest({
            url: apiPath,
            method: "GET",
            rootPath: tmp,
          });
          expect(handled, `expected ${apiPath} to not be handled`).toBe(false);
        }
      },
    });
  });

  it("does not handle /plugins paths when basePath is empty", async () => {
    await withControlUiRoot({
      fn: async (tmp) => {
        for (const pluginPath of ["/plugins", "/plugins/diffs/view/abc/def"]) {
          const { handled } = await runControlUiRequest({
            url: pluginPath,
            method: "GET",
            rootPath: tmp,
          });
          expect(handled, `expected ${pluginPath} to not be handled`).toBe(false);
        }
      },
    });
  });

  it("falls through POST requests when basePath is empty", async () => {
    await withControlUiRoot({
      fn: async (tmp) => {
        const { handled, end } = await runControlUiRequest({
          url: "/webhook/bluebubbles",
          method: "POST",
          rootPath: tmp,
        });
        expect(handled).toBe(false);
        expect(end).not.toHaveBeenCalled();
      },
    });
  });

  it("falls through POST requests under configured basePath (plugin webhook passthrough)", async () => {
    await withControlUiRoot({
      fn: async (tmp) => {
        for (const route of ["/genesis", "/genesis/", "/genesis/some-page"]) {
          const { handled, end } = await runControlUiRequest({
            url: route,
            method: "POST",
            rootPath: tmp,
            basePath: "/genesis",
          });
          expect(handled, `POST to ${route} should pass through to plugin handlers`).toBe(false);
          expect(end, `POST to ${route} should not write a response`).not.toHaveBeenCalled();
        }
      },
    });
  });

  it("rejects absolute-path escape attempts under basePath routes", async () => {
    await withBasePathRootFixture({
      siblingDir: "ui-secrets",
      fn: async ({ root, sibling }) => {
        const secretPath = path.join(sibling, "secret.txt");
        await fs.writeFile(secretPath, "sensitive-data");

        const secretPathUrl = secretPath.split(path.sep).join("/");
        const absolutePathUrl = secretPathUrl.startsWith("/") ? secretPathUrl : `/${secretPathUrl}`;
        const { res, end, handled } = await runControlUiRequest({
          url: `/genesis/${absolutePathUrl}`,
          method: "GET",
          rootPath: root,
          basePath: "/genesis",
        });
        expectNotFoundResponse({ handled, res, end });
      },
    });
  });

  it("rejects symlink escape attempts under basePath routes", async () => {
    await withBasePathRootFixture({
      siblingDir: "outside",
      fn: async ({ root, sibling }) => {
        await fs.mkdir(path.join(root, "assets"), { recursive: true });
        const secretPath = path.join(sibling, "secret.txt");
        await fs.writeFile(secretPath, "sensitive-data");

        const linkPath = path.join(root, "assets", "leak.txt");
        try {
          await fs.symlink(secretPath, linkPath, "file");
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "EPERM") {
            return;
          }
          throw error;
        }

        const { res, end, handled } = await runControlUiRequest({
          url: "/genesis/assets/leak.txt",
          method: "GET",
          rootPath: root,
          basePath: "/genesis",
        });
        expectNotFoundResponse({ handled, res, end });
      },
    });
  });
});
