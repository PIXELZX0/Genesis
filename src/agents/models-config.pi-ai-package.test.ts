import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { GenesisConfig } from "../config/types.genesis.js";
import { planGenesisModelsJson } from "./models-config.plan.js";
import { readPiAiPackageMtimeMs } from "./pi-ai-package.js";

vi.mock("./pi-ai-package.js", () => ({
  readPiAiPackageMtimeMs: vi.fn().mockResolvedValue(1000),
}));

vi.mock("./models-config.plan.js", () => ({
  planGenesisModelsJson: vi.fn().mockResolvedValue({ action: "noop" }),
}));

const readPiAiPackageMtimeMsMock = vi.mocked(readPiAiPackageMtimeMs);
const planGenesisModelsJsonMock = vi.mocked(planGenesisModelsJson);

let ensureGenesisModelsJson: typeof import("./models-config.js").ensureGenesisModelsJson;
let resetModelsJsonReadyCacheForTest: typeof import("./models-config.js").resetModelsJsonReadyCacheForTest;

describe("models-config pi-ai package fingerprint", () => {
  beforeAll(async () => {
    ({ ensureGenesisModelsJson, resetModelsJsonReadyCacheForTest } =
      await import("./models-config.js"));
  });

  beforeEach(() => {
    resetModelsJsonReadyCacheForTest();
    readPiAiPackageMtimeMsMock.mockResolvedValue(1000);
    planGenesisModelsJsonMock.mockClear();
  });

  it("includes the pi-ai package mtime in the models.json fingerprint", async () => {
    const agentDir = await fs.mkdtemp(path.join(os.tmpdir(), "genesis-pi-ai-"));
    const config: GenesisConfig = {};

    try {
      await ensureGenesisModelsJson(config, agentDir);
      await ensureGenesisModelsJson(config, agentDir);
      expect(planGenesisModelsJsonMock).toHaveBeenCalledTimes(1);

      readPiAiPackageMtimeMsMock.mockResolvedValue(2000);
      await ensureGenesisModelsJson(config, agentDir);
      expect(planGenesisModelsJsonMock).toHaveBeenCalledTimes(2);
    } finally {
      await fs.rm(agentDir, { recursive: true, force: true });
    }
  });
});
