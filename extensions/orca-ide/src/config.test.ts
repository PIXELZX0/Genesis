import { describe, expect, it } from "vitest";
import { resolveOrcaIdeConfig } from "./config.js";

describe("resolveOrcaIdeConfig", () => {
  it("applies defaults when config is undefined", () => {
    expect(resolveOrcaIdeConfig(undefined)).toEqual({
      command: "orca",
      environment: undefined,
      pairingCode: undefined,
      timeoutMs: 30_000,
      waitTimeoutMs: 300_000,
    });
  });

  it("resolves explicit values and converts seconds to milliseconds", () => {
    expect(
      resolveOrcaIdeConfig({
        command: "orca-ide",
        environment: "prod",
        pairingCode: "abc123",
        timeoutSeconds: 10,
        waitTimeoutSeconds: 90,
      }),
    ).toEqual({
      command: "orca-ide",
      environment: "prod",
      pairingCode: "abc123",
      timeoutMs: 10_000,
      waitTimeoutMs: 90_000,
    });
  });

  it("rejects unknown keys (additionalProperties: false via strictObject)", () => {
    expect(() => resolveOrcaIdeConfig({ bogus: true })).toThrow();
  });

  it("rejects an empty command string", () => {
    expect(() => resolveOrcaIdeConfig({ command: "" })).toThrow();
  });
});
