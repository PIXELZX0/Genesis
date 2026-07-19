import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GatewayRequestHandlerOptions } from "./types.js";

const mocks = vi.hoisted(() => ({
  readConfigFileSnapshot: vi.fn(),
  replaceConfigFile: vi.fn(),
  getChannelPlugin: vi.fn(),
}));

vi.mock("../../config/config.js", () => ({
  loadConfig: vi.fn(() => ({})),
  readConfigFileSnapshot: mocks.readConfigFileSnapshot,
  replaceConfigFile: mocks.replaceConfigFile,
}));

vi.mock("../../config/plugin-auto-enable.js", () => ({
  applyPluginAutoEnable: vi.fn(({ config }) => ({ config, changes: [] })),
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
    req: { type: "req", id: "req-1", method: "channels.delete", params },
    params,
    client: null,
    isWebchatConnect: () => false,
    respond: vi.fn(),
    context: {
      startChannel: vi.fn(),
      stopChannel: vi.fn(),
      getRuntimeSnapshot: vi.fn(() => ({ channels: {}, channelAccounts: {} })),
    },
    ...overrides,
  } as unknown as GatewayRequestHandlerOptions;
}

describe("channelsHandlers channels.delete", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readConfigFileSnapshot.mockResolvedValue({ valid: true, config: { channels: {} } });
    mocks.replaceConfigFile.mockResolvedValue({});
  });

  it("stops the channel, deletes the account from config, and responds with the result", async () => {
    const deleteAccount = vi.fn(({ cfg }) => ({ ...cfg, deleted: true }));
    const onAccountRemoved = vi.fn();
    mocks.getChannelPlugin.mockReturnValue({
      id: "whatsapp",
      config: {
        defaultAccountId: () => "default-account",
        listAccountIds: () => ["default-account"],
        resolveAccount: () => ({}),
        deleteAccount,
      },
      lifecycle: { onAccountRemoved },
    });
    const respond = vi.fn();
    const stopChannel = vi.fn();

    await channelsHandlers["channels.delete"](
      createOptions(
        { channel: "whatsapp" },
        {
          respond,
          context: {
            stopChannel,
            startChannel: vi.fn(),
            getRuntimeSnapshot: vi.fn(),
          } as unknown as GatewayRequestHandlerOptions["context"],
        },
      ),
    );

    expect(stopChannel).toHaveBeenCalledWith("whatsapp", "default-account");
    expect(deleteAccount).toHaveBeenCalledWith({
      cfg: { channels: {} },
      accountId: "default-account",
    });
    expect(onAccountRemoved).toHaveBeenCalled();
    expect(mocks.replaceConfigFile).toHaveBeenCalledWith({
      nextConfig: { channels: {}, deleted: true },
    });
    expect(respond).toHaveBeenCalledWith(
      true,
      { channel: "whatsapp", accountId: "default-account", deleted: true },
      undefined,
    );
  });

  it("rejects channels that do not support delete", async () => {
    mocks.getChannelPlugin.mockReturnValue({
      id: "whatsapp",
      config: {
        defaultAccountId: () => "default-account",
        listAccountIds: () => ["default-account"],
        resolveAccount: () => ({}),
      },
    });
    const respond = vi.fn();

    await channelsHandlers["channels.delete"](createOptions({ channel: "whatsapp" }, { respond }));

    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({
        message: expect.stringContaining("does not support delete"),
      }),
    );
    expect(mocks.replaceConfigFile).not.toHaveBeenCalled();
  });

  it("rejects invalid params", async () => {
    const respond = vi.fn();

    await channelsHandlers["channels.delete"](createOptions({}, { respond }));

    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({
        message: expect.stringContaining("invalid channels.delete params"),
      }),
    );
  });

  it("rejects when config is invalid", async () => {
    mocks.readConfigFileSnapshot.mockResolvedValue({ valid: false });
    mocks.getChannelPlugin.mockReturnValue({
      id: "whatsapp",
      config: {
        defaultAccountId: () => "default-account",
        listAccountIds: () => ["default-account"],
        resolveAccount: () => ({}),
        deleteAccount: vi.fn(),
      },
    });
    const respond = vi.fn();

    await channelsHandlers["channels.delete"](createOptions({ channel: "whatsapp" }, { respond }));

    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({
        message: expect.stringContaining("config invalid"),
      }),
    );
  });
});
