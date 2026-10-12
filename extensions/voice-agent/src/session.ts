import { randomUUID } from "node:crypto";
import type { GenesisConfig } from "genesis/plugin-sdk/config-runtime";
import { formatErrorMessage } from "genesis/plugin-sdk/error-runtime";
import type { PluginRuntime, RuntimeLogger } from "genesis/plugin-sdk/plugin-runtime";
import {
  getRealtimeTranscriptionProvider,
  type RealtimeTranscriptionProviderPlugin,
  type RealtimeTranscriptionSession,
} from "genesis/plugin-sdk/realtime-transcription";
import { consultRealtimeVoiceAgent } from "genesis/plugin-sdk/realtime-voice";
import { handleVoiceAgentAudioCommand, VOICE_AGENT_NODE_COMMAND } from "./audio-host.js";
import type { VoiceAgentConfig } from "./config.js";

/** One call into the audio host: in-process on the gateway, `node.invoke` for a node. */
export type VoiceAgentAudioInvoke = (
  params: Record<string, unknown>,
  timeoutMs: number,
) => Promise<Record<string, unknown>>;

export type VoiceAgentStatus = {
  id: string;
  target: string;
  sttProvider: string;
  state: "listening" | "thinking" | "speaking" | "stopped";
  startedAt: string;
  turns: number;
  lastTranscript?: string;
  lastReply?: string;
  error?: string;
};

export type VoiceAgentSession = {
  status: () => VoiceAgentStatus;
  stop: () => Promise<void>;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function createLocalAudioInvoke(): VoiceAgentAudioInvoke {
  return async (params) =>
    asRecord(JSON.parse(await handleVoiceAgentAudioCommand(JSON.stringify(params))));
}

export function createNodeAudioInvoke(
  runtime: Pick<PluginRuntime, "nodes">,
  nodeId: string,
): VoiceAgentAudioInvoke {
  return async (params, timeoutMs) => {
    const raw = asRecord(
      await runtime.nodes.invoke({ nodeId, command: VOICE_AGENT_NODE_COMMAND, params, timeoutMs }),
    );
    return asRecord(raw.payload ?? raw);
  };
}

export function resolveVoiceAgentSttProvider(params: {
  config: VoiceAgentConfig;
  fullConfig: GenesisConfig;
  provider?: RealtimeTranscriptionProviderPlugin;
}) {
  const { config, fullConfig } = params;
  const provider =
    params.provider ?? getRealtimeTranscriptionProvider(config.stt.provider, fullConfig);
  if (!provider) {
    throw new Error(`realtime transcription provider "${config.stt.provider}" is not registered`);
  }
  const rawProviderConfig = {
    ...config.stt.providers[provider.id],
    // Mic capture format; providers that ignore these keys keep their defaults.
    audioFormat: "pcm_16000",
    sampleRate: 16_000,
  };
  const providerConfig =
    provider.resolveConfig?.({ cfg: fullConfig, rawConfig: rawProviderConfig }) ??
    rawProviderConfig;
  if (!provider.isConfigured({ cfg: fullConfig, providerConfig })) {
    throw new Error(`realtime transcription provider "${provider.id}" is not configured`);
  }
  return { provider, providerConfig };
}

export async function startVoiceAgentSession(params: {
  config: VoiceAgentConfig;
  fullConfig: GenesisConfig;
  runtime: Pick<PluginRuntime, "agent" | "tts">;
  logger: RuntimeLogger;
  target: string;
  invoke: VoiceAgentAudioInvoke;
  onStopped?: () => void;
  /** Test seam; defaults to the registry lookup for `config.stt.provider`. */
  provider?: RealtimeTranscriptionProviderPlugin;
}): Promise<VoiceAgentSession> {
  const { config, fullConfig, logger, invoke } = params;
  const { provider, providerConfig } = resolveVoiceAgentSttProvider({
    config,
    fullConfig,
    provider: params.provider,
  });

  const id = `voice-agent:${randomUUID()}`;
  const status: VoiceAgentStatus = {
    id,
    target: params.target,
    sttProvider: provider.id,
    state: "listening",
    startedAt: new Date().toISOString(),
    turns: 0,
  };
  const transcript: Array<{ role: "user" | "assistant"; text: string }> = [];
  const pending: string[] = [];
  let busy = false;
  let stt: RealtimeTranscriptionSession | undefined;
  // Function call keeps TS from narrowing `state` across awaits.
  const isStopped = () => status.state === "stopped";

  const { captureId } = (await invoke(
    { action: "start", inputCommand: config.audioInputCommand },
    10_000,
  )) as { captureId?: string };
  if (!captureId) {
    throw new Error("audio host did not return a captureId");
  }

  const stop = async (error?: string) => {
    if (isStopped()) {
      return;
    }
    status.state = "stopped";
    status.error ??= error;
    stt?.close();
    await invoke({ action: "stop", captureId }, 5_000).catch(() => undefined);
    params.onStopped?.();
  };

  const speak = async (text: string) => {
    const tts = await params.runtime.tts.textToSpeechTelephony({ text, cfg: fullConfig });
    if (!tts.success || !tts.audioBuffer || !tts.sampleRate) {
      throw new Error(tts.error ?? "TTS failed");
    }
    // PCM16 duration + slack, so long replies don't trip the node invoke timeout.
    const durationMs = (tts.audioBuffer.byteLength / 2 / tts.sampleRate) * 1000;
    await invoke(
      {
        action: "play",
        base64: tts.audioBuffer.toString("base64"),
        sampleRate: tts.sampleRate,
        outputCommand: config.audioOutputCommand,
      },
      durationMs + 15_000,
    );
  };

  // Turns are serialized; utterances that arrive mid-turn are merged into the next one.
  const drainTurns = async () => {
    if (busy) {
      return;
    }
    busy = true;
    try {
      while (pending.length > 0 && !isStopped()) {
        const question = pending.splice(0).join(" ");
        status.state = "thinking";
        const { text } = await consultRealtimeVoiceAgent({
          cfg: fullConfig,
          agentRuntime: params.runtime.agent,
          logger,
          sessionKey: `voice-agent:${params.target}`,
          messageProvider: "voice-agent",
          lane: "voice-agent",
          runIdPrefix: id,
          args: { question },
          transcript,
          surface: `a spoken conversation through the ${params.target} microphone`,
          userLabel: "User",
          agentId: config.agentId,
          thinkLevel: "low",
          extraSystemPrompt:
            "You are a voice assistant. Your reply is spoken aloud: keep it short, natural, and free of markdown.",
        });
        transcript.push({ role: "user", text: question }, { role: "assistant", text });
        transcript.splice(0, Math.max(0, transcript.length - 24));
        status.turns += 1;
        status.lastReply = text;
        if (isStopped()) {
          break;
        }
        status.state = "speaking";
        await speak(text);
        if (!isStopped()) {
          status.state = "listening";
        }
      }
    } catch (error) {
      logger.warn(`[voice-agent] turn failed: ${formatErrorMessage(error)}`);
      if (!isStopped()) {
        status.state = "listening";
      }
    } finally {
      busy = false;
    }
  };

  try {
    stt = provider.createSession({
      providerConfig,
      onTranscript: (text) => {
        const trimmed = text.trim();
        if (!trimmed || isStopped()) {
          return;
        }
        status.lastTranscript = trimmed;
        pending.push(trimmed);
        void drainTurns();
      },
      onError: (error) => logger.warn(`[voice-agent] STT error: ${formatErrorMessage(error)}`),
    });
    await stt.connect();
  } catch (error) {
    await stop(formatErrorMessage(error));
    throw error;
  }

  void (async () => {
    while (!isStopped()) {
      try {
        const result = await invoke({ action: "pull", captureId, timeoutMs: 250 }, 5_000);
        // Half-duplex: drop mic audio while the agent talks so it doesn't hear itself.
        if (typeof result.base64 === "string" && status.state !== "speaking") {
          stt?.sendAudio(Buffer.from(result.base64, "base64"));
        }
        if (result.closed === true) {
          await stop(typeof result.error === "string" ? result.error : "microphone closed");
        }
      } catch (error) {
        // A pull racing `stop()` fails with an unknown captureId; that is not an error.
        if (!isStopped()) {
          logger.warn(`[voice-agent] audio input failed: ${formatErrorMessage(error)}`);
          await stop(formatErrorMessage(error));
        }
      }
    }
  })();

  logger.info(`[voice-agent] listening on ${params.target} (stt=${provider.id})`);
  return { status: () => ({ ...status }), stop: () => stop() };
}
