import { describe, expect, it } from "vitest";
import {
  ensureGenesisExecMarkerOnProcess,
  markGenesisExecEnv,
  GENESIS_CLI_ENV_VALUE,
  GENESIS_CLI_ENV_VAR,
} from "./genesis-exec-env.js";

describe("markGenesisExecEnv", () => {
  it("returns a cloned env object with the exec marker set", () => {
    const env = { PATH: "/usr/bin", GENESIS_CLI: "0" };
    const marked = markGenesisExecEnv(env);

    expect(marked).toEqual({
      PATH: "/usr/bin",
      GENESIS_CLI: GENESIS_CLI_ENV_VALUE,
    });
    expect(marked).not.toBe(env);
    expect(env.GENESIS_CLI).toBe("0");
  });
});

describe("ensureGenesisExecMarkerOnProcess", () => {
  it.each([
    {
      name: "mutates and returns the provided process env",
      env: { PATH: "/usr/bin" } as NodeJS.ProcessEnv,
    },
    {
      name: "overwrites an existing marker on the provided process env",
      env: { PATH: "/usr/bin", [GENESIS_CLI_ENV_VAR]: "0" } as NodeJS.ProcessEnv,
    },
  ])("$name", ({ env }) => {
    expect(ensureGenesisExecMarkerOnProcess(env)).toBe(env);
    expect(env[GENESIS_CLI_ENV_VAR]).toBe(GENESIS_CLI_ENV_VALUE);
  });

  it("defaults to mutating process.env when no env object is provided", () => {
    const previous = process.env[GENESIS_CLI_ENV_VAR];
    delete process.env[GENESIS_CLI_ENV_VAR];

    try {
      expect(ensureGenesisExecMarkerOnProcess()).toBe(process.env);
      expect(process.env[GENESIS_CLI_ENV_VAR]).toBe(GENESIS_CLI_ENV_VALUE);
    } finally {
      if (previous === undefined) {
        delete process.env[GENESIS_CLI_ENV_VAR];
      } else {
        process.env[GENESIS_CLI_ENV_VAR] = previous;
      }
    }
  });
});
