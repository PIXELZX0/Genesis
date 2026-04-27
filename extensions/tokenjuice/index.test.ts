import fs from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestPluginApi } from "../../test/helpers/plugins/plugin-api.js";

const { tokenjuiceFactory, createTokenjuiceGenesisEmbeddedExtension } = vi.hoisted(() => {
  const tokenjuiceFactory = vi.fn((runtime: { on: (event: string, handler: unknown) => void }) => {
    runtime.on("tool_result", () => ({ details: { compacted: true } }));
  });
  const createTokenjuiceGenesisEmbeddedExtension = vi.fn(async () => tokenjuiceFactory);
  return {
    tokenjuiceFactory,
    createTokenjuiceGenesisEmbeddedExtension,
  };
});

vi.mock("./runtime-api.js", () => ({
  createTokenjuiceGenesisEmbeddedExtension,
}));

import plugin from "./index.js";

describe("tokenjuice bundled plugin", () => {
  beforeEach(() => {
    createTokenjuiceGenesisEmbeddedExtension.mockClear();
    tokenjuiceFactory.mockClear();
  });

  it("is opt-in by default", () => {
    const manifest = JSON.parse(
      fs.readFileSync(new URL("./genesis.plugin.json", import.meta.url), "utf8"),
    ) as { enabledByDefault?: unknown };

    expect(manifest.enabledByDefault).toBeUndefined();
  });

  it("registers tokenjuice tool result middleware for Pi and Codex runtimes", async () => {
    const registerAgentToolResultMiddleware = vi.fn();

    plugin.register(
      createTestPluginApi({
        id: "tokenjuice",
        name: "tokenjuice",
        source: "test",
        config: {},
        pluginConfig: {},
        runtime: {} as never,
        registerAgentToolResultMiddleware,
      }),
    );

    expect(registerAgentToolResultMiddleware).toHaveBeenCalledWith(expect.any(Function), {
      runtimes: ["pi", "codex"],
    });

    const middleware = registerAgentToolResultMiddleware.mock.calls[0]?.[0];
    expect(middleware).toEqual(expect.any(Function));
    const result = await middleware(
      {
        toolCallId: "call_1",
        toolName: "exec_command",
        args: {},
        result: { content: [], details: { raw: true } } as never,
      },
      { runtime: "codex" },
    );

    expect(createTokenjuiceGenesisEmbeddedExtension).toHaveBeenCalledTimes(1);
    expect(tokenjuiceFactory).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      result: { content: [], details: { compacted: true } },
    });
  });
});
