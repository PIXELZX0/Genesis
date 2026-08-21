import path from "node:path";
import { describe, expect, it } from "vitest";
import type { GenesisConfig } from "../config/types.genesis.js";
import { resolveContactLegacyAgentDirs } from "./config.js";

describe("resolveContactLegacyAgentDirs", () => {
  it("does not import environment legacy dirs outside an explicit state-root override", () => {
    const env = {
      GENESIS_STATE_DIR: path.resolve("/tmp/genesis-isolated-state"),
      GENESIS_AGENT_DIR: path.resolve("/tmp/genesis-legacy-agent"),
      PI_CODING_AGENT_DIR: path.resolve("/tmp/pi-legacy-agent"),
    } as NodeJS.ProcessEnv;

    expect(resolveContactLegacyAgentDirs(undefined, { env })).toEqual([]);
  });

  it("keeps explicit and configured agent dirs as migration sources", () => {
    const configuredAgentDir = path.resolve("/tmp/genesis-configured-agent");
    const explicitAgentDir = path.resolve("/tmp/genesis-explicit-agent");
    const env = {
      GENESIS_STATE_DIR: path.resolve("/tmp/genesis-isolated-state"),
      GENESIS_AGENT_DIR: path.resolve("/tmp/genesis-legacy-agent"),
    } as NodeJS.ProcessEnv;
    const cfg = {
      agents: { list: [{ id: "configured", agentDir: configuredAgentDir }] },
    } as GenesisConfig;

    expect(resolveContactLegacyAgentDirs(cfg, { agentDir: explicitAgentDir, env })).toEqual([
      configuredAgentDir,
      explicitAgentDir,
    ]);
  });
});
