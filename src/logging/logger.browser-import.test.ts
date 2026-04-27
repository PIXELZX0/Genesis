import { afterEach, describe, expect, it, vi } from "vitest";
import { importFreshModule } from "../../test/helpers/import-fresh.js";

type LoggerModule = typeof import("./logger.js");

const originalGetBuiltinModule = (
  process as NodeJS.Process & { getBuiltinModule?: (id: string) => unknown }
).getBuiltinModule;

async function importBrowserSafeLogger(params?: {
  resolvePreferredGenesisTmpDir?: ReturnType<typeof vi.fn>;
}): Promise<{
  module: LoggerModule;
  resolvePreferredGenesisTmpDir: ReturnType<typeof vi.fn>;
}> {
  const resolvePreferredGenesisTmpDir =
    params?.resolvePreferredGenesisTmpDir ??
    vi.fn(() => {
      throw new Error("resolvePreferredGenesisTmpDir should not run during browser-safe import");
    });

  vi.doMock("../infra/tmp-genesis-dir.js", async () => {
    const actual = await vi.importActual<typeof import("../infra/tmp-genesis-dir.js")>(
      "../infra/tmp-genesis-dir.js",
    );
    return {
      ...actual,
      resolvePreferredGenesisTmpDir,
    };
  });

  Object.defineProperty(process, "getBuiltinModule", {
    configurable: true,
    value: undefined,
  });

  const module = await importFreshModule<LoggerModule>(
    import.meta.url,
    "./logger.js?scope=browser-safe",
  );
  return { module, resolvePreferredGenesisTmpDir };
}

describe("logging/logger browser-safe import", () => {
  afterEach(() => {
    vi.doUnmock("../infra/tmp-genesis-dir.js");
    Object.defineProperty(process, "getBuiltinModule", {
      configurable: true,
      value: originalGetBuiltinModule,
    });
  });

  it("does not resolve the preferred temp dir at import time when node fs is unavailable", async () => {
    const { module, resolvePreferredGenesisTmpDir } = await importBrowserSafeLogger();

    expect(resolvePreferredGenesisTmpDir).not.toHaveBeenCalled();
    expect(module.DEFAULT_LOG_DIR).toBe("/tmp/genesis");
    expect(module.DEFAULT_LOG_FILE).toBe("/tmp/genesis/genesis.log");
  });

  it("disables file logging when imported in a browser-like environment", async () => {
    const { module, resolvePreferredGenesisTmpDir } = await importBrowserSafeLogger();

    expect(module.getResolvedLoggerSettings()).toMatchObject({
      level: "silent",
      file: "/tmp/genesis/genesis.log",
    });
    expect(module.isFileLogLevelEnabled("info")).toBe(false);
    expect(() => module.getLogger().info("browser-safe")).not.toThrow();
    expect(resolvePreferredGenesisTmpDir).not.toHaveBeenCalled();
  });
});
