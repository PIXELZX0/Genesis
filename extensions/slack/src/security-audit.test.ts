import { describe, expect, it, vi } from "vitest";
import type { ResolvedSlackAccount } from "./accounts.js";
import type { GenesisConfig } from "./runtime-api.js";
import { collectSlackSecurityAuditFindings } from "./security-audit.js";

const { readChannelAllowFromStoreMock } = vi.hoisted(() => ({
  readChannelAllowFromStoreMock: vi.fn(async () => [] as string[]),
}));

vi.mock("genesis/plugin-sdk/conversation-runtime", () => ({
  readChannelAllowFromStore: readChannelAllowFromStoreMock,
}));

function createSlackAccount(config: NonNullable<GenesisConfig["channels"]>["slack"]) {
  return {
    accountId: "default",
    enabled: true,
    botToken: "xoxb-test",
    botTokenSource: "config",
    appTokenSource: "config",
    config,
  } as ResolvedSlackAccount;
}

function createSlashCommandSlackConfig(options: { useAccessGroups?: boolean } = {}): GenesisConfig {
  return {
    ...(options.useAccessGroups === undefined
      ? {}
      : { commands: { useAccessGroups: options.useAccessGroups } }),
    channels: {
      slack: {
        enabled: true,
        botToken: "xoxb-test",
        appToken: "xapp-test",
        groupPolicy: "open",
        slashCommand: { enabled: true },
      },
    },
  };
}

async function collectSlackFindingsForConfig(cfg: GenesisConfig) {
  readChannelAllowFromStoreMock.mockResolvedValue([]);
  return await collectSlackSecurityAuditFindings({
    cfg,
    account: createSlackAccount(cfg.channels!.slack),
    accountId: "default",
  });
}

describe("Slack security audit findings", () => {
  it("flags slash commands without a channel users allowlist", async () => {
    const findings = await collectSlackFindingsForConfig(createSlashCommandSlackConfig());

    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          checkId: "channels.slack.commands.slash.no_allowlists",
          severity: "warn",
        }),
      ]),
    );
  });

  it("flags slash commands when access-group enforcement is disabled", async () => {
    const findings = await collectSlackFindingsForConfig(
      createSlashCommandSlackConfig({ useAccessGroups: false }),
    );

    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          checkId: "channels.slack.commands.slash.useAccessGroups_off",
          severity: "critical",
        }),
      ]),
    );
  });
});
