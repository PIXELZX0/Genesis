import { describe, expect, it } from "vitest";
import { buildPlatformRuntimeLogHints, buildPlatformServiceStartHints } from "./runtime-hints.js";

describe("buildPlatformRuntimeLogHints", () => {
  it("renders launchd log hints on darwin", () => {
    expect(
      buildPlatformRuntimeLogHints({
        platform: "darwin",
        env: {
          GENESIS_STATE_DIR: "/tmp/genesis-state",
          GENESIS_LOG_PREFIX: "gateway",
        },
        systemdServiceName: "genesis-gateway",
        windowsTaskName: "Genesis Gateway",
      }),
    ).toEqual([
      "Launchd stdout (if installed): /tmp/genesis-state/logs/gateway.log",
      "Launchd stderr (if installed): /tmp/genesis-state/logs/gateway.err.log",
      "Restart attempts: /tmp/genesis-state/logs/gateway-restart.log",
    ]);
  });

  it("renders systemd and windows hints by platform", () => {
    expect(
      buildPlatformRuntimeLogHints({
        platform: "linux",
        env: {
          GENESIS_STATE_DIR: "/tmp/genesis-state",
        },
        systemdServiceName: "genesis-gateway",
        windowsTaskName: "Genesis Gateway",
      }),
    ).toEqual([
      "Logs: journalctl --user -u genesis-gateway.service -n 200 --no-pager",
      "Restart attempts: /tmp/genesis-state/logs/gateway-restart.log",
    ]);
    expect(
      buildPlatformRuntimeLogHints({
        platform: "win32",
        env: {
          GENESIS_STATE_DIR: "/tmp/genesis-state",
        },
        systemdServiceName: "genesis-gateway",
        windowsTaskName: "Genesis Gateway",
      }),
    ).toEqual([
      'Logs: schtasks /Query /TN "Genesis Gateway" /V /FO LIST',
      "Restart attempts: /tmp/genesis-state/logs/gateway-restart.log",
    ]);
  });
});

describe("buildPlatformServiceStartHints", () => {
  it("builds platform-specific service start hints", () => {
    expect(
      buildPlatformServiceStartHints({
        platform: "darwin",
        installCommand: "genesis gateway install",
        startCommand: "genesis gateway",
        launchAgentPlistPath: "~/Library/LaunchAgents/com.genesis.gateway.plist",
        systemdServiceName: "genesis-gateway",
        windowsTaskName: "Genesis Gateway",
      }),
    ).toEqual([
      "genesis gateway install",
      "genesis gateway",
      "launchctl bootstrap gui/$UID ~/Library/LaunchAgents/com.genesis.gateway.plist",
    ]);
    expect(
      buildPlatformServiceStartHints({
        platform: "linux",
        installCommand: "genesis gateway install",
        startCommand: "genesis gateway",
        launchAgentPlistPath: "~/Library/LaunchAgents/com.genesis.gateway.plist",
        systemdServiceName: "genesis-gateway",
        windowsTaskName: "Genesis Gateway",
      }),
    ).toEqual([
      "genesis gateway install",
      "genesis gateway",
      "systemctl --user start genesis-gateway.service",
    ]);
  });
});
