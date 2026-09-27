/* @vitest-environment jsdom */

import { render } from "lit";
import { describe, expect, it, vi } from "vitest";
import type { AttentionItem } from "../types.ts";
import { renderOverview, type OverviewProps } from "./overview.ts";

function createOverviewProps(overrides: Partial<OverviewProps> = {}): OverviewProps {
  return {
    warnQueryToken: false,
    connected: false,
    setup: { modelReady: null, defaultModelLabel: null, channelReady: null, chatReady: null },
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
    onlineChannelCount: 0,
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
    render(
      renderOverview(createOverviewProps({ sessionsCount: 5, onlineChannelCount: 3 })),
      container,
    );
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
    expect(text).toContain("Status");
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
    expect(text).toContain("Recent activity");
    expect(text).toContain("Channel disconnected");
    expect(text).toContain("Telegram lost its connection.");
  });

  it("shows the setup checklist with the next step highlighted until everything is done", async () => {
    const onNavigate = vi.fn();
    const container = document.createElement("div");
    render(
      renderOverview(
        createOverviewProps({
          onNavigate,
          setup: {
            modelReady: false,
            defaultModelLabel: "openai/gpt-5.4",
            channelReady: false,
            chatReady: false,
          },
        }),
      ),
      container,
    );
    await Promise.resolve();
    const checklist = container.querySelector(".overview-setup");
    expect(checklist?.textContent).toContain("Get started · 0/3");
    expect(checklist?.textContent).toContain("openai/gpt-5.4 needs an API key");
    const primary = checklist?.querySelectorAll<HTMLButtonElement>("button.primary");
    expect(primary).toHaveLength(1);
    primary?.[0]?.click();
    expect(onNavigate).toHaveBeenCalledWith("config");

    render(
      renderOverview(
        createOverviewProps({
          setup: {
            modelReady: true,
            defaultModelLabel: "openai/gpt-5.4",
            channelReady: true,
            chatReady: true,
          },
        }),
      ),
      container,
    );
    await Promise.resolve();
    expect(container.querySelector(".overview-setup")).toBeNull();
  });

  it("skips checklist steps it cannot verify", async () => {
    const container = document.createElement("div");
    render(
      renderOverview(
        createOverviewProps({
          setup: {
            modelReady: null,
            defaultModelLabel: null,
            channelReady: false,
            chatReady: true,
          },
        }),
      ),
      container,
    );
    await Promise.resolve();
    const text = container.querySelector(".overview-setup")?.textContent ?? "";
    expect(text).toContain("Get started · 1/2");
    expect(text).not.toContain("Connect a model");
  });

  it("renders a daily usage bar per non-empty day", async () => {
    const daily = [
      { date: "2026-09-21", tokens: 1000, cost: 0.5, messages: 2, toolCalls: 0, errors: 0 },
      { date: "2026-09-22", tokens: 0, cost: 0, messages: 0, toolCalls: 0, errors: 0 },
      { date: "2026-09-23", tokens: 500, cost: 0.25, messages: 1, toolCalls: 0, errors: 0 },
    ];
    const container = document.createElement("div");
    const usageResult = {
      aggregates: { daily },
    } as unknown as OverviewProps["usageResult"];
    render(renderOverview(createOverviewProps({ usageResult })), container);
    await Promise.resolve();
    const bars = container.querySelectorAll(".daily-bar");
    expect(bars.length).toBe(2);
    // Tallest day fills the chart; half-sized day is half as tall.
    expect((bars[0] as HTMLElement).style.height).toBe("120px");
    expect((bars[1] as HTMLElement).style.height).toBe("60px");
    expect(container.textContent ?? "").toContain("Usage");
  });
});
