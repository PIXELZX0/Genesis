import { describe, expect, it, vi } from "vitest";
import { handleVoiceAgentAudioCommand } from "./audio-host.js";
import { resolveVoiceAgentConfig } from "./config.js";
import { startVoiceAgentSession, type VoiceAgentAudioInvoke } from "./session.js";

async function audio(params: Record<string, unknown>) {
  return JSON.parse(await handleVoiceAgentAudioCommand(JSON.stringify(params)));
}

describe("voice-agent audio host", () => {
  it("captures stdout from the input command and reports close", async () => {
    const { captureId } = await audio({ action: "start", inputCommand: ["printf", "abc"] });
    let collected = "";
    for (let i = 0; i < 20; i += 1) {
      const result = await audio({ action: "pull", captureId, timeoutMs: 50 });
      collected += result.base64 ? Buffer.from(result.base64, "base64").toString() : "";
      if (result.closed) {
        break;
      }
    }
    expect(collected).toBe("abc");
    expect(await audio({ action: "stop", captureId })).toEqual({ ok: true, stopped: true });
  });

  it("substitutes the sample rate into the output command", async () => {
    await expect(
      audio({
        action: "play",
        base64: Buffer.from("x").toString("base64"),
        sampleRate: 24_000,
        outputCommand: ["sh", "-c", 'test "$0" = 24000 && cat >/dev/null', "{sampleRate}"],
      }),
    ).resolves.toEqual({ ok: true });
  });
});

describe("startVoiceAgentSession", () => {
  it("runs transcript -> agent -> tts -> speaker and mutes the mic while speaking", async () => {
    let onTranscript: ((text: string) => void) | undefined;
    const sentAudio: Buffer[] = [];
    const provider = {
      id: "fake",
      label: "Fake",
      isConfigured: () => true,
      createSession: (req: { onTranscript?: (text: string) => void }) => {
        onTranscript = req.onTranscript;
        return {
          connect: async () => {},
          sendAudio: (chunk: Buffer) => sentAudio.push(chunk),
          close: () => {},
          isConnected: () => true,
        };
      },
    };
    let releasePlay: (() => void) | undefined;
    const played: Array<Record<string, unknown>> = [];
    const invoke = vi.fn<VoiceAgentAudioInvoke>(async (params) => {
      switch (params.action) {
        case "start":
          return { captureId: "cap" };
        case "pull":
          await new Promise((resolve) => setTimeout(resolve, 5));
          return { closed: false, base64: Buffer.from("mic").toString("base64") };
        case "play":
          played.push(params);
          await new Promise<void>((resolve) => (releasePlay = resolve));
          return { ok: true };
        default:
          return { ok: true };
      }
    });
    const runEmbeddedPiAgent = vi.fn(async () => ({ payloads: [{ text: "Hi there." }] }));
    const runtime = {
      agent: {
        resolveAgentDir: () => "/tmp/agent",
        resolveAgentWorkspaceDir: () => "/tmp/ws",
        ensureAgentWorkspace: async () => {},
        resolveAgentTimeoutMs: () => 1_000,
        runEmbeddedPiAgent,
        session: {
          resolveStorePath: () => "/tmp/store.json",
          loadSessionStore: () => ({}),
          saveSessionStore: async () => {},
          resolveSessionFilePath: () => "/tmp/session.jsonl",
        },
      },
      tts: {
        textToSpeechTelephony: async () => ({
          success: true,
          audioBuffer: Buffer.alloc(48),
          sampleRate: 24_000,
        }),
      },
    };
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const session = await startVoiceAgentSession({
      config: resolveVoiceAgentConfig({}),
      fullConfig: {},
      runtime: runtime as never,
      logger,
      target: "gateway",
      invoke,
      provider: provider as never,
    });

    await vi.waitFor(() => expect(sentAudio.length).toBeGreaterThan(0));
    onTranscript?.("what time is it");
    await vi.waitFor(() => expect(session.status().state).toBe("speaking"));
    expect(runEmbeddedPiAgent).toHaveBeenCalledWith(
      expect.objectContaining({ sessionKey: "voice-agent:gateway", thinkLevel: "low" }),
    );
    expect(played[0]).toMatchObject({ action: "play", sampleRate: 24_000 });

    const heardBeforeSpeaking = sentAudio.length;
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(sentAudio.length).toBe(heardBeforeSpeaking);

    releasePlay?.();
    await vi.waitFor(() => expect(session.status().state).toBe("listening"));
    expect(session.status()).toMatchObject({ turns: 1, lastReply: "Hi there." });

    await session.stop();
    expect(session.status().state).toBe("stopped");
    expect(invoke).toHaveBeenCalledWith({ action: "stop", captureId: "cap" }, 5_000);
  });
});
