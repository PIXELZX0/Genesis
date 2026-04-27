import path from "node:path";
import { withTempHome as withTempHomeBase } from "../../test/helpers/temp-home.js";
import type { GenesisConfig } from "../config/types.genesis.js";

type AgentDefaultConfig = NonNullable<NonNullable<GenesisConfig["agents"]>["defaults"]>;
type LoadConfigMock = {
  mockReturnValue(value: GenesisConfig): unknown;
};

export async function withAgentCommandTempHome<T>(
  prefix: string,
  fn: (home: string) => Promise<T>,
): Promise<T> {
  return withTempHomeBase(fn, { prefix });
}

export function mockAgentCommandConfig(
  configSpy: LoadConfigMock,
  home: string,
  storePath: string,
  agentOverrides?: Partial<AgentDefaultConfig>,
): GenesisConfig {
  const cfg = {
    agents: {
      defaults: {
        model: { primary: "anthropic/claude-opus-4-6" },
        models: { "anthropic/claude-opus-4-6": {} },
        workspace: path.join(home, "genesis"),
        ...agentOverrides,
      },
    },
    session: { store: storePath, mainKey: "main" },
  } as GenesisConfig;
  configSpy.mockReturnValue(cfg);
  return cfg;
}

export function createDefaultAgentCommandResult() {
  return {
    payloads: [{ text: "ok" }],
    meta: {
      durationMs: 5,
      agentMeta: { sessionId: "s", provider: "p", model: "m" },
    },
  };
}
