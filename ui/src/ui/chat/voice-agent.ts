import type { GatewayBrowserClient, GatewayEventFrame } from "../gateway.ts";
import { extractTextFromMessage } from "./realtime-talk.ts";
import { speakText, stopTts } from "./speech.ts";

// Browser side of the voice-agent plugin: mic -> provider STT (direct, short-lived token)
// -> regular chat message in the current session -> spoken reply.

export type VoiceChatStatus = "connecting" | "listening" | "thinking" | "speaking" | "error";

export type VoiceChatCallbacks = {
  onStatus: (status: VoiceChatStatus, detail?: string) => void;
  onPartial: (text: string) => void;
  /** Called with each committed utterance; the host sends it as a chat message. */
  onUtterance: (text: string) => void;
};

type BrowserSession = { protocol?: string; url?: string; sampleRate?: number };

type ScribeEvent = { message_type?: string; text?: string; error?: string; message?: string };

const SUPPORTED_PROTOCOL = "elevenlabs-scribe-realtime";

/** Float32 mic samples at `fromRate` -> little-endian PCM16 at `toRate`, base64-encoded. */
export function encodePcm16Base64(samples: Float32Array, fromRate: number, toRate: number) {
  // ponytail: nearest-sample decimation, no low-pass; fine for speech STT.
  const ratio = fromRate / toRate;
  const length = Math.floor(samples.length / ratio);
  const bytes = new Uint8Array(length * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < length; i += 1) {
    const sample = Math.max(-1, Math.min(1, samples[Math.floor(i * ratio)] ?? 0));
    view.setInt16(i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

export class VoiceChatSession {
  private ws: WebSocket | null = null;
  private media: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private player: AudioBufferSourceNode | null = null;
  private unsubscribe: (() => void) | null = null;
  private awaitingReply = false;
  private speaking = false;
  private closed = false;

  constructor(
    private readonly client: GatewayBrowserClient,
    private readonly getSessionKey: () => string,
    private readonly callbacks: VoiceChatCallbacks,
  ) {}

  async start(): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Voice chat requires microphone access");
    }
    this.callbacks.onStatus("connecting");
    const session = await this.client.request<BrowserSession>("voiceagent.browserSession", {});
    if (session.protocol !== SUPPORTED_PROTOCOL || !session.url || !session.sampleRate) {
      throw new Error(`Unsupported voice transcription protocol: ${session.protocol ?? "none"}`);
    }
    const targetRate = session.sampleRate;
    this.media = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    });
    if (this.closed) {
      this.stop();
      return;
    }
    this.ws = new WebSocket(session.url);
    this.ws.addEventListener("message", (event) => this.handleScribeEvent(String(event.data)));
    this.ws.addEventListener("close", () => {
      if (!this.closed) {
        this.callbacks.onStatus("error", "Transcription connection closed");
      }
    });

    // Capture at the device rate and downsample; mixed-rate graphs fail in some browsers.
    this.audioContext = new AudioContext();
    // Created after awaits, so the click's user activation may not cover it.
    await this.audioContext.resume();
    const source = this.audioContext.createMediaStreamSource(this.media);
    // ponytail: ScriptProcessorNode is deprecated but needs no worklet module/CSP change;
    // move to AudioWorklet if browsers drop it.
    const processor = this.audioContext.createScriptProcessor(4096, 1, 1);
    const sourceRate = this.audioContext.sampleRate;
    processor.addEventListener("audioprocess", (event) => {
      // Half-duplex: don't transcribe the agent's own voice.
      if (this.speaking || this.ws?.readyState !== WebSocket.OPEN) {
        return;
      }
      this.ws.send(
        JSON.stringify({
          message_type: "input_audio_chunk",
          audio_base_64: encodePcm16Base64(
            event.inputBuffer.getChannelData(0),
            sourceRate,
            targetRate,
          ),
          sample_rate: targetRate,
        }),
      );
    });
    const mute = this.audioContext.createGain();
    mute.gain.value = 0;
    source.connect(processor);
    processor.connect(mute);
    mute.connect(this.audioContext.destination);

    this.unsubscribe = this.client.addEventListener((evt) => this.handleGatewayEvent(evt));
  }

  stop() {
    this.closed = true;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.ws?.close();
    this.ws = null;
    for (const track of this.media?.getTracks() ?? []) {
      track.stop();
    }
    this.media = null;
    void this.audioContext?.close();
    this.audioContext = null;
    this.player?.stop();
    this.player = null;
    stopTts();
  }

  private handleScribeEvent(raw: string) {
    let event: ScribeEvent;
    try {
      event = JSON.parse(raw) as ScribeEvent;
    } catch {
      return;
    }
    switch (event.message_type) {
      case "session_started":
        this.callbacks.onStatus("listening");
        return;
      case "partial_transcript":
        this.callbacks.onPartial(event.text ?? "");
        return;
      case "committed_transcript": {
        const text = event.text?.trim();
        this.callbacks.onPartial("");
        if (text) {
          this.awaitingReply = true;
          this.callbacks.onStatus("thinking");
          this.callbacks.onUtterance(text);
        }
        return;
      }
      default:
        if (event.message_type?.includes("error")) {
          this.callbacks.onStatus("error", event.error ?? event.message ?? event.message_type);
        }
    }
  }

  private handleGatewayEvent(evt: GatewayEventFrame) {
    if (evt.event !== "chat" || !this.awaitingReply) {
      return;
    }
    const payload = evt.payload as
      | { sessionKey?: string; state?: string; message?: unknown }
      | undefined;
    if (payload?.sessionKey !== this.getSessionKey()) {
      return;
    }
    if (payload.state === "error" || payload.state === "aborted") {
      this.awaitingReply = false;
      this.callbacks.onStatus("listening");
    } else if (payload.state === "final") {
      this.awaitingReply = false;
      void this.speak(extractTextFromMessage(payload.message));
    }
  }

  private async speak(text: string) {
    if (!text.trim() || this.closed) {
      this.callbacks.onStatus("listening");
      return;
    }
    this.speaking = true;
    this.callbacks.onStatus("speaking");
    try {
      try {
        // Gateway TTS (talk config) first so the voice matches other surfaces.
        const res = await this.client.request<{ audioBase64?: string }>("talk.speak", { text });
        const context = this.audioContext;
        if (!res.audioBase64 || !context || this.closed) {
          throw new Error("talk.speak returned no audio");
        }
        // Decode in-memory: the Control UI CSP blocks data:/blob: media URLs.
        const bytes = Uint8Array.from(atob(res.audioBase64), (char) => char.charCodeAt(0));
        const buffer = await context.decodeAudioData(bytes.buffer);
        const player = context.createBufferSource();
        player.buffer = buffer;
        player.connect(context.destination);
        this.player = player;
        await new Promise<void>((resolve) => {
          player.addEventListener("ended", () => resolve());
          player.start();
        });
      } catch {
        if (!this.closed) {
          await new Promise<void>((resolve) => {
            if (!speakText(text, { onEnd: resolve, onError: () => resolve() })) {
              resolve();
            }
          });
        }
      }
    } finally {
      this.speaking = false;
      this.player = null;
      if (!this.closed) {
        this.callbacks.onStatus("listening");
      }
    }
  }
}
