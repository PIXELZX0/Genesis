export type VoiceAgentConfig = {
  autoStart: boolean;
  node?: string;
  agentId?: string;
  stt: {
    provider: string;
    providers: Record<string, Record<string, unknown>>;
  };
  audioInputCommand?: string[];
  audioOutputCommand?: string[];
};

export const DEFAULT_VOICE_AGENT_STT_PROVIDER = "elevenlabs";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readCommand(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.length > 0 && value.every((v) => typeof v === "string")
    ? value
    : undefined;
}

export function resolveVoiceAgentConfig(value: unknown): VoiceAgentConfig {
  const raw = asRecord(value);
  const stt = asRecord(raw.stt);
  const providers = asRecord(stt.providers);
  return {
    autoStart: raw.autoStart === true,
    node: readString(raw.node),
    agentId: readString(raw.agentId),
    stt: {
      provider: readString(stt.provider) ?? DEFAULT_VOICE_AGENT_STT_PROVIDER,
      providers: Object.fromEntries(
        Object.entries(providers).map(([id, entry]) => [id, asRecord(entry)]),
      ),
    },
    audioInputCommand: readCommand(raw.audioInputCommand),
    audioOutputCommand: readCommand(raw.audioOutputCommand),
  };
}
