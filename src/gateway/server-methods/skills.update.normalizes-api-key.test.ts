import { beforeEach, describe, expect, it, vi } from "vitest";

let writtenConfig: unknown = null;
let writtenOptions: unknown = null;
let snapshotConfig: Record<string, unknown> = {
  skills: {
    entries: {},
  },
};

vi.mock("../../config/config.js", () => {
  const loadConfig = () => ({
    gateway: {
      auth: { mode: "token", token: "runtime-only-token" },
    },
    ...snapshotConfig,
  });
  return {
    loadConfig,
    readConfigFileSnapshotForWrite: async () => ({
      snapshot: {
        config: snapshotConfig,
      },
      writeOptions: {},
    }),
    writeConfigFileWithResult: async (cfg: unknown, options: unknown) => {
      writtenConfig = cfg;
      writtenOptions = options;
    },
  };
});

const { skillsHandlers } = await import("./skills.js");

describe("skills.update", () => {
  beforeEach(() => {
    writtenConfig = null;
    writtenOptions = null;
    snapshotConfig = {
      skills: {
        entries: {},
      },
    };
  });

  it("strips embedded CR/LF from apiKey", async () => {
    let ok: boolean | null = null;
    let error: unknown = null;
    await skillsHandlers["skills.update"]({
      params: {
        skillKey: "brave-search",
        apiKey: "abc\r\ndef",
      },
      req: {} as never,
      client: null as never,
      isWebchatConnect: () => false,
      context: {} as never,
      respond: (success, _result, err) => {
        ok = success;
        error = err;
      },
    });

    expect(ok).toBe(true);
    expect(error).toBeUndefined();
    expect(writtenConfig).toMatchObject({
      skills: {
        entries: {
          "brave-search": {
            apiKey: "abcdef",
          },
        },
      },
    });
  });

  it("patches from the persisted config snapshot instead of runtime-only gateway overrides", async () => {
    snapshotConfig = {
      gateway: {
        reload: { mode: "hot" },
      },
      skills: {
        entries: {
          github: { enabled: true },
        },
      },
    };

    let ok: boolean | null = null;
    let error: unknown = null;
    await skillsHandlers["skills.update"]({
      params: {
        skillKey: "github",
        enabled: false,
      },
      req: {} as never,
      client: null as never,
      isWebchatConnect: () => false,
      context: {} as never,
      respond: (success, _result, err) => {
        ok = success;
        error = err;
      },
    });

    expect(ok).toBe(true);
    expect(error).toBeUndefined();
    expect(writtenConfig).toEqual({
      gateway: {
        reload: { mode: "hot" },
      },
      skills: {
        entries: {
          github: { enabled: false },
        },
      },
    });
    expect(writtenConfig).not.toMatchObject({
      gateway: {
        auth: expect.anything(),
      },
    });
    expect(writtenOptions).toMatchObject({
      baseSnapshot: {
        config: snapshotConfig,
      },
      runtimeRefreshIncludeAuthStoreRefs: false,
    });
  });
});
