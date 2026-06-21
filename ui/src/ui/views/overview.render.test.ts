/* @vitest-environment jsdom */

import { render } from "lit";
import { describe, expect, it } from "vitest";
import type { AttentionItem } from "../types.ts";
import { renderOverview, type OverviewProps } from "./overview.ts";

function createOverviewProps(overrides: Partial<OverviewProps> = {}): OverviewProps {
  return {
    warnQueryToken: false,
    connected: false,
    hello: null,
    settings: {
      gatewayUrl: "",
      token: "",
      sessionKey: "main",
      lastActiveSessionKey: "main",
      theme: "mono",
      themeMode: "system",
      chatFocusMode: false,
      chatShowThinking: true,
      chatShowToolCalls: true,
      splitRatio: 0.6,
      navCollapsed: false,
      navWidth: 220,
      navGroupsCollapsed: {},
      borderRadius: 50,
      locale: "en",
    },
    password: "",
    lastError: null,
    lastErrorCode: null,
    presenceCount: 0,
    sessionsCount: null,
    cronEnabled: null,
    cronNext: null,
    lastChannelsRefresh: null,
    modelAuthStatus: null,
    usageResult: null,
    sessionsResult: null,
    skillsReport: null,
    cronJobs: [],
    cronStatus: null,
    walletSummary: null,
    walletSummaryError: null,
    attentionItems: [],
    eventLog: [],
    overviewLogLines: [],
    showGatewayToken: false,
    showGatewayPassword: false,
    onSettingsChange: () => undefined,
    onPasswordChange: () => undefined,
    onSessionKeyChange: () => undefined,
    onToggleGatewayTokenVisibility: () => undefined,
    onToggleGatewayPasswordVisibility: () => undefined,
    onConnect: () => undefined,
    onRefresh: () => undefined,
    onNavigate: () => undefined,
    onRefreshLogs: () => undefined,
    ...overrides,
  };
}

describe("overview view (Pencil design)", () => {
  it("renders the title and the stat row", async () => {
    const container = document.createElement("div");
    render(renderOverview(createOverviewProps({ sessionsCount: 5, presenceCount: 3 })), container);
    await Promise.resolve();
    const text = container.textContent ?? "";
    expect(container.querySelector(".view-title")?.textContent).toContain("Overview");
    expect(text).toContain("Active sessions");
    expect(text).toContain("Cron jobs");
    expect(text).toContain("Uptime");
    expect(text).toContain("5");
  });

  it("renders the status panel with gateway state", async () => {
    const container = document.createElement("div");
    render(renderOverview(createOverviewProps({ connected: true, cronEnabled: true })), container);
    await Promise.resolve();
    const text = container.textContent ?? "";
    expect(text).toContain("STATUS");
    expect(text).toContain("Gateway");
    expect(text).toContain("Online");
    expect(text).toContain("Version");
  });

  it("renders recent activity from attention items", async () => {
    const items: AttentionItem[] = [
      {
        severity: "warning",
        icon: "alert",
        title: "Channel disconnected",
        description: "Telegram lost its connection.",
      },
    ];
    const container = document.createElement("div");
    render(renderOverview(createOverviewProps({ attentionItems: items })), container);
    await Promise.resolve();
    const text = container.textContent ?? "";
    expect(text).toContain("RECENT ACTIVITY");
    expect(text).toContain("Channel disconnected");
    expect(text).toContain("Telegram lost its connection.");
  });
});
