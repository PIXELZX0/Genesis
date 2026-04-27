import type { GenesisConfig } from "genesis/plugin-sdk/config-runtime";

export function makeQqbotSecretRefConfig(): GenesisConfig {
  return {
    channels: {
      qqbot: {
        appId: "123456",
        clientSecret: {
          source: "env",
          provider: "default",
          id: "QQBOT_CLIENT_SECRET",
        },
      },
    },
  } as GenesisConfig;
}

export function makeQqbotDefaultAccountConfig(): GenesisConfig {
  return {
    channels: {
      qqbot: {
        defaultAccount: "bot2",
        accounts: {
          bot2: { appId: "123456" },
        },
      },
    },
  } as GenesisConfig;
}
