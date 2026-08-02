import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { describe, expect, it, vi } from "vitest";
import { setPluginToolMeta } from "../../../plugins/tools.js";
import type { AnyAgentTool } from "../../tools/common.js";
import type { EmbeddedRunAttemptParams } from "../run/types.js";

const mocks = vi.hoisted(() => ({
  prepareRuntime: vi.fn(),
}));

vi.mock("../run/attempt-tools.js", () => ({
  prepareEmbeddedAttemptToolRuntime: mocks.prepareRuntime,
}));

import { createPiIsolationToolHost } from "./tool-host.js";

function createTool(name: string): AnyAgentTool {
  return {
    name,
    label: name,
    description: `${name} fixture`,
    parameters: { type: "object" } as never,
    execute: async (): Promise<AgentToolResult<unknown>> => ({ content: [], details: {} }),
  };
}

describe("PI isolation tool host", () => {
  it("forwards the runtime allowlist and preserves plugin metadata in descriptors", async () => {
    const pluginTool = createTool("fixture_plugin");
    setPluginToolMeta(pluginTool, { pluginId: "fixture-plugin", optional: true });
    mocks.prepareRuntime.mockResolvedValueOnce({
      resolvedWorkspace: process.cwd(),
      effectiveWorkspace: process.cwd(),
      sandboxSessionKey: "session-1",
      sandbox: undefined,
      sessionAgentId: "main",
      agentDir: process.cwd(),
      toolsRaw: [createTool("read"), pluginTool],
    });

    const host = await createPiIsolationToolHost({
      toolsAllow: ["read", "sessions_yield"],
    } as unknown as EmbeddedRunAttemptParams);

    expect(mocks.prepareRuntime).toHaveBeenCalledWith(
      expect.objectContaining({ toolAllowlist: ["read", "sessions_yield"] }),
    );
    expect(host.descriptors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "read" }),
        expect.objectContaining({
          name: "fixture_plugin",
          pluginMeta: { pluginId: "fixture-plugin", optional: true },
        }),
      ]),
    );
  });
});
