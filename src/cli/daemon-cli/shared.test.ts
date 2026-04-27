import { describe, expect, it } from "vitest";
import { theme } from "../../terminal/theme.js";
import {
  filterContainerGenericHints,
  renderGatewayServiceStartHints,
  resolveDaemonContainerContext,
  resolveRuntimeStatusColor,
} from "./shared.js";

describe("resolveRuntimeStatusColor", () => {
  it("maps known runtime states to expected theme colors", () => {
    expect(resolveRuntimeStatusColor("running")).toBe(theme.success);
    expect(resolveRuntimeStatusColor("stopped")).toBe(theme.error);
    expect(resolveRuntimeStatusColor("unknown")).toBe(theme.muted);
  });

  it("falls back to warning color for unexpected states", () => {
    expect(resolveRuntimeStatusColor("degraded")).toBe(theme.warn);
    expect(resolveRuntimeStatusColor(undefined)).toBe(theme.muted);
  });
});

describe("renderGatewayServiceStartHints", () => {
  it("resolves daemon container context from either env key", () => {
    expect(
      resolveDaemonContainerContext({
        GENESIS_CONTAINER: "genesis-demo-container",
      } as NodeJS.ProcessEnv),
    ).toBe("genesis-demo-container");
    expect(
      resolveDaemonContainerContext({
        GENESIS_CONTAINER_HINT: "genesis-demo-container",
      } as NodeJS.ProcessEnv),
    ).toBe("genesis-demo-container");
  });

  it("prepends a single container restart hint when GENESIS_CONTAINER is set", () => {
    expect(
      renderGatewayServiceStartHints({
        GENESIS_CONTAINER: "genesis-demo-container",
      } as NodeJS.ProcessEnv),
    ).toEqual(
      expect.arrayContaining([
        "Restart the container or the service that manages it for genesis-demo-container.",
      ]),
    );
  });

  it("prepends a single container restart hint when GENESIS_CONTAINER_HINT is set", () => {
    expect(
      renderGatewayServiceStartHints({
        GENESIS_CONTAINER_HINT: "genesis-demo-container",
      } as NodeJS.ProcessEnv),
    ).toEqual(
      expect.arrayContaining([
        "Restart the container or the service that manages it for genesis-demo-container.",
      ]),
    );
  });
});

describe("filterContainerGenericHints", () => {
  it("drops the generic container foreground hint when GENESIS_CONTAINER is set", () => {
    expect(
      filterContainerGenericHints(
        [
          "systemd user services are unavailable; install/enable systemd or run the gateway under your supervisor.",
          "If you're in a container, run the gateway in the foreground instead of `genesis gateway`.",
        ],
        { GENESIS_CONTAINER: "genesis-demo-container" } as NodeJS.ProcessEnv,
      ),
    ).toEqual([]);
  });

  it("drops the generic container foreground hint when GENESIS_CONTAINER_HINT is set", () => {
    expect(
      filterContainerGenericHints(
        [
          "systemd user services are unavailable; install/enable systemd or run the gateway under your supervisor.",
          "If you're in a container, run the gateway in the foreground instead of `genesis gateway`.",
        ],
        { GENESIS_CONTAINER_HINT: "genesis-demo-container" } as NodeJS.ProcessEnv,
      ),
    ).toEqual([]);
  });
});
