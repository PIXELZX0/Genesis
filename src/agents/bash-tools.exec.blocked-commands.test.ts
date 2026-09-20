import { describe, expect, it } from "vitest";
import { __testing } from "./bash-tools.exec.js";

const reject = __testing.rejectBlockedExecShellCommand;

function expectGatewayRestartBlocked(command: string): void {
  expect(() => reject(command)).toThrow(/exec cannot restart the gateway/);
}

describe("rejectBlockedExecShellCommand", () => {
  it("blocks gateway restarts so agents go through the gateway tool", () => {
    expectGatewayRestartBlocked("genesis gateway restart");
    expectGatewayRestartBlocked("genesis gateway restart --deep");
    expectGatewayRestartBlocked("  GENESIS_LOG=debug genesis gateway restart");
    expectGatewayRestartBlocked("sudo /usr/local/bin/genesis gateway restart");
    expectGatewayRestartBlocked('bash -lc "genesis gateway restart"');
    expectGatewayRestartBlocked("pnpm genesis gateway restart");
    expectGatewayRestartBlocked("ls && genesis gateway restart");
  });

  it("keeps other genesis gateway commands runnable", () => {
    expect(() => reject("genesis gateway status --deep")).not.toThrow();
    expect(() => reject("genesis gateway install --force")).not.toThrow();
    expect(() => reject("genesis doctor --non-interactive")).not.toThrow();
    expect(() => reject("echo genesis gateway")).not.toThrow();
  });

  it("still blocks /approve commands", () => {
    expect(() => reject("/approve abc123 allow-once")).toThrow(/exec cannot run \/approve/);
  });
});
