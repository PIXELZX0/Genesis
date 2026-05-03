/* @vitest-environment jsdom */

import { render } from "lit";
import { describe, expect, it, vi } from "vitest";
import {
  channelEnabled,
  resolveChannelConfigured,
  resolveChannelDisplayState,
} from "./channels.shared.ts";
import { renderChannels } from "./channels.ts";
import type { ChannelsProps } from "./channels.types.ts";

function createProps(
  snapshot: ChannelsProps["snapshot"],
  overrides: Partial<ChannelsProps> = {},
): ChannelsProps {
  return {
    connected: true,
    loading: false,
    snapshot,
    lastError: null,
    lastSuccessAt: null,
    whatsappMessage: null,
    whatsappQrDataUrl: null,
    whatsappConnected: null,
    whatsappBusy: false,
    configSchema: null,
    configSchemaLoading: false,
    configForm: null,
    configUiHints: {},
    configSaving: false,
    configFormDirty: false,
    nostrProfileFormState: null,
    nostrProfileAccountId: null,
    channelWizardStep: null,
    channelWizardInput: null,
    channelWizardBusy: false,
    channelWizardError: null,
    channelWizardMessage: null,
    onRefresh: () => {},
    onChannelWizardStart: () => {},
    onChannelWizardSubmit: () => {},
    onChannelWizardCancel: () => {},
    onChannelWizardInput: () => {},
    onChannelWizardClose: () => {},
    onWhatsAppStart: () => {},
    onWhatsAppWait: () => {},
    onWhatsAppLogout: () => {},
    onConfigPatch: () => {},
    onConfigSave: () => {},
    onConfigReload: () => {},
    onNostrProfileEdit: () => {},
    onNostrProfileCancel: () => {},
    onNostrProfileFieldChange: () => {},
    onNostrProfileSave: () => {},
    onNostrProfileImport: () => {},
    onNostrProfileToggleAdvanced: () => {},
    ...overrides,
  };
}

describe("channel display selectors", () => {
  it("returns the channel summary configured flag when present", () => {
    const props = createProps({
      ts: Date.now(),
      channelOrder: ["guildchat"],
      channelLabels: { guildchat: "Guild Chat" },
      channels: { guildchat: { configured: false } },
      channelAccounts: {
        guildchat: [{ accountId: "guild-main", configured: true }],
      },
      channelDefaultAccountId: { guildchat: "guild-main" },
    });

    expect(resolveChannelConfigured("guildchat", props)).toBe(false);
    expect(resolveChannelDisplayState("guildchat", props).configured).toBe(false);
  });

  it("falls back to the default account when the channel summary omits configured", () => {
    const props = createProps({
      ts: Date.now(),
      channelOrder: ["guildchat"],
      channelLabels: { guildchat: "Guild Chat" },
      channels: { guildchat: { running: true } },
      channelAccounts: {
        guildchat: [
          { accountId: "default", configured: false },
          { accountId: "guild-main", configured: true },
        ],
      },
      channelDefaultAccountId: { guildchat: "guild-main" },
    });

    const displayState = resolveChannelDisplayState("guildchat", props);

    expect(resolveChannelConfigured("guildchat", props)).toBe(true);
    expect(displayState.defaultAccount?.accountId).toBe("guild-main");
    expect(channelEnabled("guildchat", props)).toBe(true);
  });

  it("falls back to the first account when no default account id is available", () => {
    const props = createProps({
      ts: Date.now(),
      channelOrder: ["workspace"],
      channelLabels: { workspace: "Workspace" },
      channels: { workspace: { running: true } },
      channelAccounts: {
        workspace: [{ accountId: "workspace-a", configured: true }],
      },
      channelDefaultAccountId: {},
    });

    const displayState = resolveChannelDisplayState("workspace", props);

    expect(resolveChannelConfigured("workspace", props)).toBe(true);
    expect(displayState.defaultAccount?.accountId).toBe("workspace-a");
  });

  it("keeps disabled channels hidden when neither summary nor accounts are active", () => {
    const props = createProps({
      ts: Date.now(),
      channelOrder: ["quietchat"],
      channelLabels: { quietchat: "Quiet Chat" },
      channels: { quietchat: {} },
      channelAccounts: {
        quietchat: [{ accountId: "default", configured: false, running: false, connected: false }],
      },
      channelDefaultAccountId: { quietchat: "default" },
    });

    const displayState = resolveChannelDisplayState("quietchat", props);

    expect(displayState.configured).toBe(false);
    expect(displayState.running).toBeNull();
    expect(displayState.connected).toBeNull();
    expect(channelEnabled("quietchat", props)).toBe(false);
  });
});

describe("channel setup wizard rendering", () => {
  it("starts the guided add flow from the channel toolbar", () => {
    const onChannelWizardStart = vi.fn();
    const container = document.createElement("div");
    render(renderChannels(createProps(null, { onChannelWizardStart })), container);

    const addButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Add channel"),
    );
    addButton?.click();

    expect(onChannelWizardStart).toHaveBeenCalledTimes(1);
  });

  it("renders server-provided select steps in the popup", () => {
    const onChannelWizardInput = vi.fn();
    const onChannelWizardSubmit = vi.fn();
    const container = document.createElement("div");
    render(
      renderChannels(
        createProps(null, {
          channelWizardStep: {
            id: "step-1",
            type: "select",
            message: "Select a channel",
            options: [
              { value: "telegram", label: "Telegram" },
              { value: "slack", label: "Slack", hint: "Workspace chat" },
            ],
          },
          channelWizardInput: "telegram",
          onChannelWizardInput,
          onChannelWizardSubmit,
        }),
      ),
      container,
    );

    container.querySelectorAll<HTMLButtonElement>(".channel-wizard-option")[1]?.click();
    Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.includes("Continue"))
      ?.click();

    expect(onChannelWizardInput).toHaveBeenCalledWith("slack");
    expect(onChannelWizardSubmit).toHaveBeenCalledTimes(1);
  });
});
