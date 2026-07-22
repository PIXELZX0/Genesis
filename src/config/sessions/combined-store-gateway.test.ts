import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { withTempDir } from "../../test-helpers/temp-dir.js";
import {
  clearCombinedSessionStoreCacheForTest,
  loadCombinedSessionStoreForGateway,
} from "./combined-store-gateway.js";
import { clearSessionStoreCaches } from "./store-cache.js";

describe("loadCombinedSessionStoreForGateway", () => {
  afterEach(() => {
    clearCombinedSessionStoreCacheForTest();
    clearSessionStoreCaches();
    vi.restoreAllMocks();
  });

  it("reuses the merged store until a contributing store file changes", async () => {
    await withTempDir({ prefix: "genesis-combined-store-" }, async (dir) => {
      const storePath = path.join(dir, "sessions.json");
      await fs.writeFile(
        storePath,
        JSON.stringify({ "agent:main": { sessionId: "s1", updatedAt: 1 } }),
        "utf8",
      );
      const cfg = { session: { store: storePath } };

      const first = loadCombinedSessionStoreForGateway(cfg);
      expect(Object.keys(first.store)).toHaveLength(1);

      const second = loadCombinedSessionStoreForGateway(cfg);
      expect(second.store).toEqual(first.store);
      // Callers may mutate what they get back, so each call still owns its copy.
      expect(second.store).not.toBe(first.store);

      await fs.writeFile(
        storePath,
        JSON.stringify({
          "agent:main": { sessionId: "s1", updatedAt: 2 },
          "agent:other": { sessionId: "s2", updatedAt: 3 },
        }),
        "utf8",
      );
      clearSessionStoreCaches();

      const third = loadCombinedSessionStoreForGateway(cfg);
      expect(Object.keys(third.store)).toHaveLength(2);
    });
  });
});
