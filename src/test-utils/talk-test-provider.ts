import type { GenesisConfig } from "../config/types.genesis.js";

export const TALK_TEST_PROVIDER_ID = "acme-speech";
export const TALK_TEST_PROVIDER_LABEL = "Acme Speech";
export const TALK_TEST_PROVIDER_API_KEY_PATH = `talk.providers.${TALK_TEST_PROVIDER_ID}.apiKey`;
export const TALK_TEST_PROVIDER_API_KEY_PATH_SEGMENTS = [
  "talk",
  "providers",
  TALK_TEST_PROVIDER_ID,
  "apiKey",
] as const;

export function buildTalkTestProviderConfig(apiKey: unknown): GenesisConfig {
  return {
    talk: {
      providers: {
        [TALK_TEST_PROVIDER_ID]: {
          apiKey,
        },
      },
    },
  } as GenesisConfig;
}

export function readTalkTestProviderApiKey(config: GenesisConfig): unknown {
  return config.talk?.providers?.[TALK_TEST_PROVIDER_ID]?.apiKey;
}
