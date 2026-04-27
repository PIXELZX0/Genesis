import type { AuthProfileStore } from "../agents/auth-profiles/types.js";
import type { FallbackAttempt } from "../agents/model-fallback.types.js";
import type { GenesisConfig } from "../config/types.genesis.js";
import type {
  GeneratedMusicAsset,
  MusicGenerationIgnoredOverride,
  MusicGenerationNormalization,
  MusicGenerationOutputFormat,
  MusicGenerationProvider,
  MusicGenerationSourceImage,
} from "./types.js";

export type GenerateMusicParams = {
  cfg: GenesisConfig;
  prompt: string;
  agentDir?: string;
  authStore?: AuthProfileStore;
  modelOverride?: string;
  lyrics?: string;
  instrumental?: boolean;
  durationSeconds?: number;
  format?: MusicGenerationOutputFormat;
  inputImages?: MusicGenerationSourceImage[];
  /** Optional per-request provider timeout in milliseconds. */
  timeoutMs?: number;
};

export type GenerateMusicRuntimeResult = {
  tracks: GeneratedMusicAsset[];
  provider: string;
  model: string;
  attempts: FallbackAttempt[];
  lyrics?: string[];
  normalization?: MusicGenerationNormalization;
  metadata?: Record<string, unknown>;
  ignoredOverrides: MusicGenerationIgnoredOverride[];
};

export type ListRuntimeMusicGenerationProvidersParams = {
  config?: GenesisConfig;
};

export type RuntimeMusicGenerationProvider = MusicGenerationProvider;
