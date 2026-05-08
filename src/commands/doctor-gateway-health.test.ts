import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChannelStatusIssue } from "../channels/plugins/types.public.js";

const mocks = vi.hoisted(() => ({
  buildGatewayConnectionDetails: vi.fn(() => ({ message: "Gateway details" })),
  callGateway: vi.fn(async () => ({ channelAccounts: {} })),
  collectChannelStatusIssues: vi.fn((): ChannelStatusIssue[] => []),
  healthCommand: vi.fn(async () => undefined),
  note: vi.fn(),
}));

vi.mock("../gateway/call.js", () => ({
  buildGatewayConnectionDetails: mocks.buildGatewayConnectionDetails,
  callGateway: mocks.callGateway,
}));

vi.mock("../infra/channels-status-issues.js", () => ({
  collectChannelStatusIssues: mocks.collectChannelStatusIssues,
}));

vi.mock("../terminal/note.js", () => ({
  note: mocks.note,
}));

vi.mock("./health-format.js", () => ({
  formatHealthCheckFailure: (error: unknown) => `formatted:${String(error)}`,
}));

vi.mock("./health.js", () => ({
  healthCommand: mocks.healthCommand,
}));

import { checkGatewayHealth, noteGatewayChannelStatusIssues } from "./doctor-gateway-health.js";

describe("doctor gateway health", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.buildGatewayConnectionDetails.mockReturnValue({ message: "Gateway details" });
    mocks.callGateway.mockResolvedValue({ channelAccounts: {} });
    mocks.collectChannelStatusIssues.mockReturnValue([]);
    mocks.healthCommand.mockResolvedValue(undefined);
  });

  it("checks gateway reachability without running channel status probes", async () => {
    const runtime = { error: vi.fn() };
    const result = await checkGatewayHealth({
      runtime: runtime as never,
      cfg: {},
      timeoutMs: 1234,
    });

    expect(result).toEqual({ healthOk: true });
    expect(mocks.healthCommand).toHaveBeenCalledWith(
      { json: false, timeoutMs: 1234, config: {} },
      runtime,
    );
    expect(mocks.callGateway).not.toHaveBeenCalled();
  });

  it("reports channel status issues from the separate probe", async () => {
    mocks.callGateway.mockResolvedValueOnce({ channelAccounts: { telegram: [] } });
    mocks.collectChannelStatusIssues.mockReturnValueOnce([
      {
        channel: "telegram",
        accountId: "default",
        kind: "config",
        message: "webhook is stale",
        fix: "rerun setup",
      },
    ]);

    await noteGatewayChannelStatusIssues({ probeTimeoutMs: 111, callTimeoutMs: 222 });

    expect(mocks.callGateway).toHaveBeenCalledWith({
      method: "channels.status",
      params: { probe: true, timeoutMs: 111 },
      timeoutMs: 222,
    });
    expect(mocks.note).toHaveBeenCalledWith(
      "- telegram default: webhook is stale (rerun setup)",
      "Channel warnings",
    );
  });
});
