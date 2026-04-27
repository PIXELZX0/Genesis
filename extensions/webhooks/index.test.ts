import { describe, expect, it, vi } from "vitest";
import { createTestPluginApi } from "../../test/helpers/plugins/plugin-api.js";
import type { GenesisPluginApi } from "./api.js";
import plugin from "./index.js";

function createApi(params?: {
  pluginConfig?: GenesisPluginApi["pluginConfig"];
  registerHttpRoute?: GenesisPluginApi["registerHttpRoute"];
  logger?: GenesisPluginApi["logger"];
}): GenesisPluginApi {
  return createTestPluginApi({
    id: "webhooks",
    name: "Webhooks",
    source: "test",
    pluginConfig: params?.pluginConfig ?? {},
    runtime: {
      taskFlow: {
        bindSession: vi.fn(({ sessionKey }: { sessionKey: string }) => ({ sessionKey })),
      },
    } as unknown as GenesisPluginApi["runtime"],
    registerHttpRoute: params?.registerHttpRoute ?? vi.fn(),
    logger:
      params?.logger ??
      ({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      } as GenesisPluginApi["logger"]),
  });
}

describe("webhooks plugin registration", () => {
  it("registers SecretRef-backed routes synchronously", () => {
    const registerHttpRoute = vi.fn();

    const result = plugin.register(
      createApi({
        pluginConfig: {
          routes: {
            zapier: {
              sessionKey: "agent:main:main",
              secret: {
                source: "env",
                provider: "default",
                id: "GENESIS_WEBHOOK_SECRET",
              },
            },
          },
        },
        registerHttpRoute,
      }),
    );

    expect(result).toBeUndefined();
    expect(registerHttpRoute).toHaveBeenCalledTimes(1);
    expect(registerHttpRoute).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "/plugins/webhooks/zapier",
        auth: "plugin",
        match: "exact",
        replaceExisting: true,
      }),
    );
  });
});
