import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket, WebSocketServer } from "ws";
import {
  MAX_PAYLOAD_BYTES,
  MAX_PREAUTH_PAYLOAD_BYTES,
  WS_COMPRESSION_THRESHOLD_BYTES,
} from "../../server-constants.js";
import { setSocketMaxPayload } from "./ws-payload-limit.js";

// Mirrors the production gateway WebSocketServer options.
const SERVER_OPTIONS = {
  maxPayload: MAX_PREAUTH_PAYLOAD_BYTES,
  perMessageDeflate: {
    serverNoContextTakeover: true,
    clientNoContextTakeover: true,
    threshold: WS_COMPRESSION_THRESHOLD_BYTES,
  },
} as const;

const POST_AUTH_FRAME = "g".repeat(MAX_PREAUTH_PAYLOAD_BYTES * 4);

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    await cleanups.pop()?.();
  }
});

async function roundTripAfterHandoff(raise: boolean): Promise<string> {
  const wss = new WebSocketServer({ port: 0, ...SERVER_OPTIONS });
  await new Promise<void>((resolve) => wss.once("listening", resolve));
  const { port } = wss.address() as AddressInfo;
  const outcome = new Promise<string>((resolve) => {
    wss.once("connection", (socket) => {
      if (raise) {
        setSocketMaxPayload(socket, MAX_PAYLOAD_BYTES);
      }
      socket.on("message", (data) => resolve(`message:${(data as Buffer).length}`));
      socket.on("close", () => resolve("closed"));
      // An over-limit frame makes ws emit before it closes; the close is the assertion.
      socket.on("error", () => {});
    });
  });
  const client = new WebSocket(`ws://127.0.0.1:${port}`, { perMessageDeflate: true });
  client.on("error", () => {});
  cleanups.push(async () => {
    client.terminate();
    await new Promise<void>((resolve) => wss.close(() => resolve()));
  });
  await new Promise<void>((resolve) => client.once("open", resolve));
  // A frame the client compresses well but that exceeds the preauth cap uninflated.
  client.send(POST_AUTH_FRAME);
  return await outcome;
}

describe("setSocketMaxPayload", () => {
  it("accepts large compressed frames once the authenticated limit is raised", async () => {
    expect(await roundTripAfterHandoff(true)).toBe(`message:${POST_AUTH_FRAME.length}`);
  });

  it("still enforces the preauth limit on compressed frames before the handoff", async () => {
    expect(await roundTripAfterHandoff(false)).toBe("closed");
  });
});
