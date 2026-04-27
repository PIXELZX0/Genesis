import { Command } from "commander";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { reparseProgramFromActionArgs } from "./action-reparse.js";

const buildParseArgvMock = vi.hoisted(() => vi.fn());
const resolveActionArgsMock = vi.hoisted(() => vi.fn());

vi.mock("../argv.js", () => ({
  buildParseArgv: buildParseArgvMock,
}));

vi.mock("./helpers.js", () => ({
  resolveActionArgs: resolveActionArgsMock,
}));

describe("reparseProgramFromActionArgs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    buildParseArgvMock.mockReturnValue(["node", "genesis", "status"]);
    resolveActionArgsMock.mockReturnValue([]);
  });

  it("uses action command name + args as fallback argv", async () => {
    const program = new Command().name("genesis");
    const parseAsync = vi.spyOn(program, "parseAsync").mockResolvedValue(program);
    const actionCommand = {
      name: () => "status",
      parent: {
        rawArgs: ["node", "genesis", "status", "--json"],
      },
    } as unknown as Command;
    resolveActionArgsMock.mockReturnValue(["--json"]);

    await reparseProgramFromActionArgs(program, [actionCommand]);

    expect(buildParseArgvMock).toHaveBeenCalledWith({
      programName: "genesis",
      rawArgs: ["node", "genesis", "status", "--json"],
      fallbackArgv: ["status", "--json"],
    });
    expect(parseAsync).toHaveBeenCalledWith(["node", "genesis", "status"]);
  });

  it("falls back to action args without command name when action has no name", async () => {
    const program = new Command().name("genesis");
    const parseAsync = vi.spyOn(program, "parseAsync").mockResolvedValue(program);
    const actionCommand = {
      name: () => "",
      parent: {},
    } as unknown as Command;
    resolveActionArgsMock.mockReturnValue(["--json"]);

    await reparseProgramFromActionArgs(program, [actionCommand]);

    expect(buildParseArgvMock).toHaveBeenCalledWith({
      programName: "genesis",
      rawArgs: undefined,
      fallbackArgv: ["--json"],
    });
    expect(parseAsync).toHaveBeenCalledWith(["node", "genesis", "status"]);
  });

  it("uses program root when action command is missing", async () => {
    const program = new Command().name("genesis");
    const parseAsync = vi.spyOn(program, "parseAsync").mockResolvedValue(program);

    await reparseProgramFromActionArgs(program, []);

    expect(resolveActionArgsMock).toHaveBeenCalledWith(undefined);
    expect(buildParseArgvMock).toHaveBeenCalledWith({
      programName: "genesis",
      rawArgs: [],
      fallbackArgv: [],
    });
    expect(parseAsync).toHaveBeenCalledWith(["node", "genesis", "status"]);
  });
});
