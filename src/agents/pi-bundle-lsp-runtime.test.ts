import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GenesisConfig } from "../config/types.genesis.js";
import { createBundleLspToolRuntime } from "./pi-bundle-lsp-runtime.js";

vi.mock("./embedded-pi-lsp.js", () => ({
  loadEmbeddedPiLspConfig: (params: { cfg?: { lspServers?: Record<string, unknown> } }) => ({
    diagnostics: [],
    lspServers: params.cfg?.lspServers ?? {},
  }),
}));

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

// Minimal Content-Length-framed JSON-RPC stdio server matching the client
// framing in pi-bundle-lsp-runtime.ts (parseLspMessages/encodeLspMessage).
async function writeFakeLspServer(
  filePath: string,
  params: {
    capabilities: Record<string, boolean>;
    startupDelayMs?: number;
    startedMarkerPath?: string;
  },
): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(
    filePath,
    `#!/usr/bin/env node
import fs from "node:fs";
import { setTimeout as delay } from "node:timers/promises";

const startedMarkerPath = ${JSON.stringify(params.startedMarkerPath ?? "")};
if (startedMarkerPath) {
  fs.writeFileSync(startedMarkerPath, String(Date.now()), "utf-8");
}

const startupDelayMs = ${JSON.stringify(params.startupDelayMs ?? 0)};
const capabilities = ${JSON.stringify(params.capabilities)};

let buffer = "";
process.stdin.setEncoding("utf-8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  while (true) {
    const headerEnd = buffer.indexOf("\\r\\n\\r\\n");
    if (headerEnd === -1) break;
    const header = buffer.slice(0, headerEnd);
    const match = header.match(/Content-Length:\\s*(\\d+)/i);
    if (!match) {
      buffer = buffer.slice(headerEnd + 4);
      continue;
    }
    const len = Number.parseInt(match[1], 10);
    const bodyStart = headerEnd + 4;
    const bodyEnd = bodyStart + len;
    if (Buffer.byteLength(buffer.slice(bodyStart), "utf-8") < len) break;
    const body = buffer.slice(bodyStart, bodyEnd);
    buffer = buffer.slice(bodyEnd);
    handleMessage(JSON.parse(body));
  }
});

function send(msg) {
  const json = JSON.stringify(msg);
  process.stdout.write("Content-Length: " + Buffer.byteLength(json, "utf-8") + "\\r\\n\\r\\n" + json);
}

async function handleMessage(msg) {
  if (msg.method === "initialize") {
    if (startupDelayMs > 0) await delay(startupDelayMs);
    send({ jsonrpc: "2.0", id: msg.id, result: { capabilities } });
  } else if (msg.method === "shutdown") {
    send({ jsonrpc: "2.0", id: msg.id, result: null });
  } else if (msg.method === "exit") {
    process.exit(0);
  }
}
`,
    { encoding: "utf-8", mode: 0o755 },
  );
}

describe("createBundleLspToolRuntime", () => {
  it("survives a spawn failure from one server without crashing and still starts the others", async () => {
    const tempDir = await makeTempDir("genesis-bundle-lsp-");
    const goodServerPath = path.join(tempDir, "good-server.mjs");
    await writeFakeLspServer(goodServerPath, { capabilities: { hoverProvider: true } });

    const runtime = await createBundleLspToolRuntime({
      workspaceDir: tempDir,
      cfg: {
        lspServers: {
          broken: { command: "definitely-not-a-real-binary-xyz-12345" },
          good: { command: "node", args: [goodServerPath] },
        },
      } as unknown as GenesisConfig,
    });

    try {
      expect(runtime.sessions.map((s) => s.serverName)).toEqual(["good"]);
      expect(runtime.tools.some((tool) => tool.name === "lsp_hover_good")).toBe(true);
    } finally {
      await runtime.dispose();
    }
  });

  it("spawns configured servers concurrently and keeps tool ordering deterministic by config order", async () => {
    const tempDir = await makeTempDir("genesis-bundle-lsp-");
    const slowServerPath = path.join(tempDir, "slow-server.mjs");
    const fastServerPath = path.join(tempDir, "fast-server.mjs");
    const slowMarkerPath = path.join(tempDir, "slow-started.txt");
    const fastMarkerPath = path.join(tempDir, "fast-started.txt");
    await writeFakeLspServer(slowServerPath, {
      capabilities: { hoverProvider: true },
      startupDelayMs: 250,
      startedMarkerPath: slowMarkerPath,
    });
    await writeFakeLspServer(fastServerPath, {
      capabilities: { definitionProvider: true },
      startedMarkerPath: fastMarkerPath,
    });

    const runtime = await createBundleLspToolRuntime({
      workspaceDir: tempDir,
      cfg: {
        lspServers: {
          slow: { command: "node", args: [slowServerPath] },
          fast: { command: "node", args: [fastServerPath] },
        },
      } as unknown as GenesisConfig,
    });

    try {
      // Sequential startup would only spawn "fast" after "slow" finished its
      // 250ms initialize delay; concurrent startup spawns both immediately.
      const slowStartedAt = Number.parseInt(await fs.readFile(slowMarkerPath, "utf-8"), 10);
      const fastStartedAt = Number.parseInt(await fs.readFile(fastMarkerPath, "utf-8"), 10);
      expect(Math.abs(fastStartedAt - slowStartedAt)).toBeLessThan(200);

      expect(runtime.sessions.map((s) => s.serverName)).toEqual(["slow", "fast"]);
      expect(runtime.tools.map((tool) => tool.name)).toEqual([
        "lsp_hover_slow",
        "lsp_definition_fast",
      ]);
    } finally {
      await runtime.dispose();
    }
  });
});
