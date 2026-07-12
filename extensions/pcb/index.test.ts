import type { AnyAgentTool } from "genesis/plugin-sdk/agent-runtime";
import { describe, expect, it } from "vitest";
import { createTestPluginApi } from "../../test/helpers/plugins/plugin-api.js";
import plugin from "./index.js";

describe("pcb plugin", () => {
  it("registers a single pcb tool", () => {
    let tool: AnyAgentTool | null | undefined;
    let registeredName: string | undefined;
    const api = createTestPluginApi({
      registerTool(registered, options?: { name?: string }) {
        registeredName = options?.name;
        const resolved =
          typeof registered === "function" ? registered({ workspaceDir: "/tmp/ws" }) : registered;
        tool = Array.isArray(resolved) ? resolved[0] : resolved;
      },
    });

    plugin.register(api);

    expect(registeredName).toBe("pcb");
    expect(tool?.name).toBe("pcb");
  });
});
