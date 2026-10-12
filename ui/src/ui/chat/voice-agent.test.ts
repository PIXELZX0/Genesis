import { afterEach, describe, expect, it, vi } from "vitest";
import type { GatewayBrowserClient, GatewayEventFrame } from "../gateway.ts";
import { encodePcm16Base64, VoiceChatSession, type VoiceChatStatus } from "./voice-agent.ts";

class FakeWebSocket extends EventTarget {
  static OPEN = 1;
  static last: FakeWebSocket | null = null;
  readyState = 1;
  sent: string[] = [];
  constructor(readonly url: string) {
    super();
    FakeWebSocket.last = this;
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.readyState = 3;
  }
  emit(payload: unknown) {
    this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(payload) }));
  }
}

class FakeAudioContext {
  sampleRate = 48_000;
  createMediaStreamSource() {
    return { connect: () => {} };
  }
  createScriptProcessor() {
    return { addEventListener: () => {}, connect: () => {} };
  }
  createGain() {
    return { gain: { value: 1 }, connect: () => {} };
  }
  destination = {};
  async resume() {}
  async close() {}
}

function setup() {
  let listener: ((evt: GatewayEventFrame) => void) | undefined;
  const request = vi.fn(async (method: string) =>
    method === "voiceagent.browserSession"
      ? {
          protocol: "elevenlabs-scribe-realtime",
          url: "wss://stt.test?token=t",
          sampleRate: 16_000,
        }
      : {},
  );
  const client = {
    request,
    addEventListener: (fn: (evt: GatewayEventFrame) => void) => {
      listener = fn;
      return () => {
        listener = undefined;
      };
    },
  } as unknown as GatewayBrowserClient;
  const statuses: VoiceChatStatus[] = [];
  const utterances: string[] = [];
  const session = new VoiceChatSession(client, () => "main", {
    onStatus: (status) => statuses.push(status),
    onPartial: () => {},
    onUtterance: (text) => utterances.push(text),
  });
  const emitChat = (payload: unknown) =>
    listener?.({ type: "event", event: "chat", payload } as GatewayEventFrame);
  return { session, request, statuses, utterances, emitChat };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("encodePcm16Base64", () => {
  it("downsamples float samples to little-endian PCM16", () => {
    const base64 = encodePcm16Base64(new Float32Array([1, 0, -1, 0, 0.5, 0]), 32_000, 16_000);
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    const view = new DataView(bytes.buffer);
    expect([view.getInt16(0, true), view.getInt16(2, true), view.getInt16(4, true)]).toEqual([
      0x7fff,
      -0x8000,
      Math.floor(0.5 * 0x7fff),
    ]);
  });
});

describe("VoiceChatSession", () => {
  it("sends committed transcripts as chat and speaks the final reply for this session", async () => {
    vi.stubGlobal("WebSocket", FakeWebSocket);
    vi.stubGlobal("AudioContext", FakeAudioContext);
    vi.stubGlobal("navigator", {
      mediaDevices: { getUserMedia: async () => ({ getTracks: () => [] }) },
    });
    const speechSynthesis = { speak: vi.fn(), cancel: vi.fn(), speaking: false };
    vi.stubGlobal("speechSynthesis", speechSynthesis);
    vi.stubGlobal(
      "SpeechSynthesisUtterance",
      class extends EventTarget {
        constructor(readonly text: string) {
          super();
        }
      },
    );
    const { session, request, statuses, utterances, emitChat } = setup();

    await session.start();
    expect(FakeWebSocket.last?.url).toBe("wss://stt.test?token=t");
    FakeWebSocket.last?.emit({ message_type: "session_started" });
    FakeWebSocket.last?.emit({ message_type: "committed_transcript", text: " hello there " });
    expect(utterances).toEqual(["hello there"]);

    emitChat({ sessionKey: "other", state: "final", message: { text: "not mine" } });
    expect(request).not.toHaveBeenCalledWith("talk.speak", expect.anything());

    // talk.speak returns no audio here, so the browser speech fallback is used.
    emitChat({ sessionKey: "main", state: "final", message: { text: "Hi!" } });
    await vi.waitFor(() => expect(speechSynthesis.speak).toHaveBeenCalled());
    expect(request).toHaveBeenCalledWith("talk.speak", { text: "Hi!" });
    expect(statuses).toEqual(["connecting", "listening", "thinking", "speaking"]);

    session.stop();
    expect(FakeWebSocket.last?.readyState).toBe(3);
  });

  it("rejects unknown transcription protocols", async () => {
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: async () => ({}) } });
    const { session, request } = setup();
    request.mockResolvedValueOnce({ protocol: "other", url: "wss://x", sampleRate: 16_000 });
    await expect(session.start()).rejects.toThrow("Unsupported voice transcription protocol");
  });
});
