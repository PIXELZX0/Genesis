import type { GenesisConfig } from "genesis/plugin-sdk/config-runtime";
import { describe, expect } from "vitest";
import {
  installChannelActionsContractSuite,
  installChannelSetupContractSuite,
  installChannelStatusContractSuite,
} from "../../../test/helpers/channels/registry-contract-suites.js";
import { mattermostPlugin, mattermostSetupPlugin } from "../channel-plugin-api.js";

describe("mattermost actions contract", () => {
  installChannelActionsContractSuite({
    plugin: mattermostPlugin,
    unsupportedAction: "poll",
    cases: [
      {
        name: "configured account exposes send and react",
        cfg: {
          channels: {
            mattermost: {
              enabled: true,
              botToken: "test-token",
              baseUrl: "https://chat.example.com",
            },
          },
        } as GenesisConfig,
        expectedActions: ["send", "react"],
        expectedCapabilities: ["presentation"],
      },
      {
        name: "reactions can be disabled while send stays available",
        cfg: {
          channels: {
            mattermost: {
              enabled: true,
              botToken: "test-token",
              baseUrl: "https://chat.example.com",
              actions: { reactions: false },
            },
          },
        } as GenesisConfig,
        expectedActions: ["send"],
        expectedCapabilities: ["presentation"],
      },
      {
        name: "missing bot credentials disables the actions surface",
        cfg: {
          channels: {
            mattermost: {
              enabled: true,
            },
          },
        } as GenesisConfig,
        expectedActions: [],
        expectedCapabilities: [],
      },
    ],
  });
});

describe("mattermost setup contract", () => {
  installChannelSetupContractSuite({
    plugin: mattermostSetupPlugin,
    cases: [
      {
        name: "default account stores token and normalized base URL",
        cfg: {} as GenesisConfig,
        input: {
          botToken: "test-token",
          httpUrl: "https://chat.example.com/",
        },
        expectedAccountId: "default",
        assertPatchedConfig: (cfg) => {
          expect(cfg.channels?.mattermost?.enabled).toBe(true);
          expect(cfg.channels?.mattermost?.botToken).toBe("test-token");
          expect(cfg.channels?.mattermost?.baseUrl).toBe("https://chat.example.com");
        },
      },
      {
        name: "missing credentials are rejected",
        cfg: {} as GenesisConfig,
        input: {
          httpUrl: "",
        },
        expectedAccountId: "default",
        expectedValidation: "Mattermost requires --bot-token and --http-url (or --use-env).",
      },
    ],
  });
});

describe("mattermost status contract", () => {
  installChannelStatusContractSuite({
    plugin: mattermostPlugin,
    cases: [
      {
        name: "configured account preserves connectivity details in the snapshot",
        cfg: {
          channels: {
            mattermost: {
              enabled: true,
              botToken: "test-token",
              baseUrl: "https://chat.example.com",
            },
          },
        } as GenesisConfig,
        runtime: {
          accountId: "default",
          connected: true,
          lastConnectedAt: 1234,
        },
        probe: { ok: true },
        assertSnapshot: (snapshot) => {
          expect(snapshot.accountId).toBe("default");
          expect(snapshot.enabled).toBe(true);
          expect(snapshot.configured).toBe(true);
          expect(snapshot.connected).toBe(true);
          expect(snapshot.baseUrl).toBe("https://chat.example.com");
        },
      },
    ],
  });
});
