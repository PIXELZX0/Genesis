import type { GenesisConfig } from "../config/types.genesis.js";
import type { TtsAutoMode, TtsConfig, TtsMode, TtsProvider } from "../config/types.tts.js";
import type { SpeechModelOverridePolicy, SpeechProviderConfig } from "./provider-types.js";

export type ResolvedTtsModelOverrides = SpeechModelOverridePolicy;

export type ResolvedTtsConfig = {
  auto: TtsAutoMode;
  mode: TtsMode;
  provider: TtsProvider;
  providerSource: "config" | "default";
  summaryModel?: string;
  modelOverrides: ResolvedTtsModelOverrides;
  providerConfigs: Record<string, SpeechProviderConfig>;
  prefsPath?: string;
  maxTextLength: number;
  timeoutMs: number;
  rawConfig?: TtsConfig;
  sourceConfig?: GenesisConfig;
};
