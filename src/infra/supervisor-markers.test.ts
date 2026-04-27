import { describe, expect, it } from "vitest";
import { detectRespawnSupervisor, SUPERVISOR_HINT_ENV_VARS } from "./supervisor-markers.js";

describe("SUPERVISOR_HINT_ENV_VARS", () => {
  it("includes the cross-platform supervisor hint env vars", () => {
    expect(SUPERVISOR_HINT_ENV_VARS).toEqual(
      expect.arrayContaining([
        "LAUNCH_JOB_LABEL",
        "INVOCATION_ID",
        "GENESIS_WINDOWS_TASK_NAME",
        "GENESIS_SERVICE_MARKER",
        "GENESIS_SERVICE_KIND",
      ]),
    );
  });
});

describe("detectRespawnSupervisor", () => {
  it("detects launchd and systemd only from non-blank platform-specific hints", () => {
    expect(detectRespawnSupervisor({ LAUNCH_JOB_LABEL: " ai.genesis.gateway " }, "darwin")).toBe(
      "launchd",
    );
    expect(detectRespawnSupervisor({ LAUNCH_JOB_LABEL: "   " }, "darwin")).toBeNull();

    expect(detectRespawnSupervisor({ INVOCATION_ID: "abc123" }, "linux")).toBe("systemd");
    expect(detectRespawnSupervisor({ JOURNAL_STREAM: "" }, "linux")).toBeNull();
  });

  it("detects scheduled-task supervision on Windows from either hint family", () => {
    expect(detectRespawnSupervisor({ GENESIS_WINDOWS_TASK_NAME: "Genesis Gateway" }, "win32")).toBe(
      "schtasks",
    );
    expect(
      detectRespawnSupervisor(
        {
          GENESIS_SERVICE_MARKER: "genesis",
          GENESIS_SERVICE_KIND: "gateway",
        },
        "win32",
      ),
    ).toBe("schtasks");
    expect(
      detectRespawnSupervisor(
        {
          GENESIS_SERVICE_MARKER: "genesis",
          GENESIS_SERVICE_KIND: "worker",
        },
        "win32",
      ),
    ).toBeNull();
  });

  it("ignores service markers on non-Windows platforms and unknown platforms", () => {
    expect(
      detectRespawnSupervisor(
        {
          GENESIS_SERVICE_MARKER: "genesis",
          GENESIS_SERVICE_KIND: "gateway",
        },
        "linux",
      ),
    ).toBeNull();
    expect(
      detectRespawnSupervisor({ LAUNCH_JOB_LABEL: "ai.genesis.gateway" }, "freebsd"),
    ).toBeNull();
  });
});
