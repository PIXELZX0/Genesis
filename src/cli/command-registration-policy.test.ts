import { describe, expect, it } from "vitest";
import {
  shouldEagerRegisterSubcommands,
  shouldRegisterPrimaryCommandOnly,
  shouldRegisterPrimarySubcommandOnly,
  shouldSkipPluginCommandRegistration,
} from "./command-registration-policy.js";

describe("command-registration-policy", () => {
  it("matches primary command registration policy", () => {
    expect(shouldRegisterPrimaryCommandOnly(["node", "genesis", "status"])).toBe(true);
    expect(shouldRegisterPrimaryCommandOnly(["node", "genesis", "status", "--help"])).toBe(true);
    expect(shouldRegisterPrimaryCommandOnly(["node", "genesis", "-V"])).toBe(false);
    expect(shouldRegisterPrimaryCommandOnly(["node", "genesis", "acp", "-v"])).toBe(true);
  });

  it("matches plugin registration skip policy", () => {
    expect(
      shouldSkipPluginCommandRegistration({
        argv: ["node", "genesis", "--help"],
        primary: null,
        hasBuiltinPrimary: false,
      }),
    ).toBe(true);
    expect(
      shouldSkipPluginCommandRegistration({
        argv: ["node", "genesis", "config", "--help"],
        primary: "config",
        hasBuiltinPrimary: true,
      }),
    ).toBe(true);
    expect(
      shouldSkipPluginCommandRegistration({
        argv: ["node", "genesis", "voicecall", "--help"],
        primary: "voicecall",
        hasBuiltinPrimary: false,
      }),
    ).toBe(false);
  });

  it("matches lazy subcommand registration policy", () => {
    expect(shouldEagerRegisterSubcommands({ GENESIS_DISABLE_LAZY_SUBCOMMANDS: "1" })).toBe(true);
    expect(shouldEagerRegisterSubcommands({ GENESIS_DISABLE_LAZY_SUBCOMMANDS: "0" })).toBe(false);
    expect(shouldRegisterPrimarySubcommandOnly(["node", "genesis", "acp"], {})).toBe(true);
    expect(shouldRegisterPrimarySubcommandOnly(["node", "genesis", "acp", "--help"], {})).toBe(
      true,
    );
    expect(
      shouldRegisterPrimarySubcommandOnly(["node", "genesis", "acp"], {
        GENESIS_DISABLE_LAZY_SUBCOMMANDS: "1",
      }),
    ).toBe(false);
  });
});
