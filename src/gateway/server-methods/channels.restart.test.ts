import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChannelRuntimeSnapshot } from "../server-channel-runtime.types.js";
import type { GatewayRequestHandlerOptions } from "./types.js";

const mocks = vi.hoisted(() => ({
  loadConfig: vi.fn(() => ({})),
  applyPluginAutoEnable: vi.fn(),
  getChannelPlugin: vi.fn(),
}));

vi.mock("../../config/config.js", () => ({
  loadConfig: mocks.loadConfig,
  readConfigFileSnapshot: vi.fn(),
}));

vi.mock("../../config/plugin-auto-enable.js", () => ({
  applyPluginAutoEnable: mocks.applyPluginAutoEnable,
}));

vi.mock("../../channels/plugins/index.js", () => ({
  listChannelPlugins: vi.fn(),
  getChannelPlugin: mocks.getChannelPlugin,
  normalizeChannelId: (value: string) => value,
}));

import { channelsHandlers } from "./channels.js";

function createOptions(
  params: Record<string, unknown>,
  overrides?: Partial<GatewayRequestHandlerOptions>,
): GatewayRequestHandlerOptions {
  return {
    req: { type: "req", id: "req-1", method: "channels.restart", params },
    params,
    client: null,
    isWebchatConnect: () => false,
    respond: vi.fn(),
    context: {
      startChannel: vi.fn(),
      stopChannel: vi.fn(),
      getRuntimeSnapshot: vi.fn(
        (): ChannelRuntimeSnapshot => ({
          channels: {
            whatsapp: {
              accountId: "default-account",
              running: true,
            },
          },
          channelAccounts: {
            whatsapp: {
              "default-account": {
                accountId: "default-account",
                running: true,
              },
            },
          },
        }),
      ),
    },
    ...overrides,
  } as unknown as GatewayRequestHandlerOptions;
}

describe("channelsHandlers channels.restart", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadConfig.mockReturnValue({});
    mocks.applyPluginAutoEnable.mockImplementation(({ config }) => ({ config, changes: [] }));
    mocks.getChannelPlugin.mockReturnValue({
      id: "whatsapp",
      gateway: { startAccount: vi.fn() },
      config: {
        defaultAccountId: () => "default-account",
        listAccountIds: () => ["default-account"],
        resolveAccount: () => ({}),
      },
    });
  });

  it("stops then starts the channel runtime for the resolved account", async () => {
    const startChannel = vi.fn();
    const stopChannel = vi.fn();
    const respond = vi.fn();
    const callOrder: string[] = [];
    startChannel.mockImplementation(() => callOrder.push("start"));
    stopChannel.mockImplementation(() => callOrder.push("stop"));

    await channelsHandlers["channels.restart"](
      createOptions(
        { channel: "whatsapp" },
        {
          respond,
          context: {
            startChannel,
            stopChannel,
            getRuntimeSnapshot: vi.fn(
              (): ChannelRuntimeSnapshot => ({
                channels: {
                  whatsapp: {
                    accountId: "default-account",
                    running: true,
                  },
                },
                channelAccounts: {
                  whatsapp: {
                    "default-account": {
                      accountId: "default-account",
                      running: true,
                    },
                  },
                },
              }),
            ),
          } as unknown as GatewayRequestHandlerOptions["context"],
        },
      ),
    );

    expect(stopChannel).toHaveBeenCalledWith("whatsapp", "default-account");
    expect(startChannel).toHaveBeenCalledWith("whatsapp", "default-account");
    expect(callOrder).toEqual(["stop", "start"]);
    expect(respond).toHaveBeenCalledWith(
      true,
      {
        channel: "whatsapp",
        accountId: "default-account",
        started: true,
      },
      undefined,
    );
  });

  it("rejects channels that do not support runtime start", async () => {
    mocks.getChannelPlugin.mockReturnValue({
      id: "whatsapp",
      gateway: {},
      config: {
        defaultAccountId: () => "default-account",
        listAccountIds: () => ["default-account"],
        resolveAccount: () => ({}),
      },
    });
    const respond = vi.fn();

    await channelsHandlers["channels.restart"](createOptions({ channel: "whatsapp" }, { respond }));

    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({
        message: expect.stringContaining("does not support restart"),
      }),
    );
  });

  it("rejects invalid params", async () => {
    const respond = vi.fn();

    await channelsHandlers["channels.restart"](createOptions({}, { respond }));

    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({
        message: expect.stringContaining("invalid channels.restart params"),
      }),
    );
  });
});
