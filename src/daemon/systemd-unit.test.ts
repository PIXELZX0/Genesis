import { describe, expect, it } from "vitest";
import { buildSystemdUnit } from "./systemd-unit.js";

describe("buildSystemdUnit", () => {
  it("quotes arguments with whitespace", () => {
    const unit = buildSystemdUnit({
      description: "Genesis Gateway",
      programArguments: ["/usr/bin/genesis", "gateway", "--name", "My Bot"],
      environment: {},
    });
    const execStart = unit.split("\n").find((line) => line.startsWith("ExecStart="));
    expect(execStart).toBe('ExecStart=/usr/bin/genesis gateway --name "My Bot"');
  });

  it("renders control-group kill mode for child-process cleanup", () => {
    const unit = buildSystemdUnit({
      description: "Genesis Gateway",
      programArguments: ["/usr/bin/genesis", "gateway", "run"],
      environment: {},
    });
    expect(unit).toContain("KillMode=control-group");
    expect(unit).toContain("TimeoutStopSec=30");
    expect(unit).toContain("TimeoutStartSec=30");
    expect(unit).toContain("SuccessExitStatus=0 143");
    expect(unit).toContain("StartLimitBurst=5");
    expect(unit).toContain("StartLimitIntervalSec=60");
    expect(unit).toContain("RestartPreventExitStatus=78");
  });

  it("rejects environment values with line breaks", () => {
    expect(() =>
      buildSystemdUnit({
        description: "Genesis Gateway",
        programArguments: ["/usr/bin/genesis", "gateway", "start"],
        environment: {
          INJECT: "ok\nExecStartPre=/bin/touch /tmp/oc15789_rce",
        },
      }),
    ).toThrow(/CR or LF/);
  });

  it("renders EnvironmentFile entries before inline Environment values", () => {
    const unit = buildSystemdUnit({
      description: "Genesis Gateway",
      programArguments: ["/usr/bin/genesis", "gateway", "run"],
      environmentFiles: ["/home/test/.genesis/.env"],
      environment: {
        GENESIS_GATEWAY_PORT: "18789",
      },
    });
    expect(unit).toContain("EnvironmentFile=-/home/test/.genesis/.env");
    expect(unit).toContain("Environment=GENESIS_GATEWAY_PORT=18789");
    expect(unit.indexOf("EnvironmentFile=-/home/test/.genesis/.env")).toBeLessThan(
      unit.indexOf("Environment=GENESIS_GATEWAY_PORT=18789"),
    );
  });
});
