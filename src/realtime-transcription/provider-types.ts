import type { GenesisConfig } from "../config/types.genesis.js";

export type RealtimeTranscriptionProviderId = string;

export type RealtimeTranscriptionProviderConfig = Record<string, unknown>;

export type RealtimeTranscriptionProviderResolveConfigContext = {
  cfg: GenesisConfig;
  rawConfig: RealtimeTranscriptionProviderConfig;
};

export type RealtimeTranscriptionProviderConfiguredContext = {
  cfg?: GenesisConfig;
  providerConfig: RealtimeTranscriptionProviderConfig;
};

export type RealtimeTranscriptionSessionCallbacks = {
  onPartial?: (partial: string) => void;
  onTranscript?: (transcript: string) => void;
  onSpeechStart?: () => void;
  onError?: (error: Error) => void;
};

export type RealtimeTranscriptionSessionCreateRequest = RealtimeTranscriptionSessionCallbacks & {
  providerConfig: RealtimeTranscriptionProviderConfig;
};

/**
 * Short-lived credentials a browser uses to stream mic audio straight to the provider.
 * `protocol` names the wire format the client must speak; clients reject protocols they
 * do not implement.
 */
export type RealtimeTranscriptionBrowserSession = {
  provider: RealtimeTranscriptionProviderId;
  protocol: "elevenlabs-scribe-realtime";
  /** WebSocket URL with auth already embedded (single-use token). */
  url: string;
  /** PCM16 mono sample rate the URL was negotiated for. */
  sampleRate: number;
  expiresAt?: number;
};

export type RealtimeTranscriptionBrowserSessionCreateRequest = {
  providerConfig: RealtimeTranscriptionProviderConfig;
};

export type RealtimeTranscriptionSession = {
  connect(): Promise<void>;
  sendAudio(audio: Buffer): void;
  close(): void;
  isConnected(): boolean;
};
