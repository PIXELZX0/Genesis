import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  isConfigBackupId,
  listConfigBackups,
  resolveConfigBackupFilePath,
} from "./config-backups.js";

const CONFIG_PATH = "/tmp/genesis/genesis.json";
const BACKUP_DIR = "/tmp/genesis/config_backup";

function createStatFs(files: Record<string, { size: number; mtimeMs: number }>) {
  return {
    stat: async (filePath: string) => {
      const stat = files[filePath];
      if (!stat) {
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      }
      return stat;
    },
  };
}

describe("config backup ids", () => {
  it("accepts the rotation ring and last-good only", () => {
    expect(isConfigBackupId("bak")).toBe(true);
    expect(isConfigBackupId("bak.4")).toBe(true);
    expect(isConfigBackupId("last-good")).toBe(true);
    expect(isConfigBackupId("bak.9")).toBe(false);
    expect(isConfigBackupId("clobbered.2026-01-01")).toBe(false);
  });

  it("refuses to build paths for ids it does not hand out", () => {
    expect(resolveConfigBackupFilePath(CONFIG_PATH, "bak.1")).toBe(
      path.join(BACKUP_DIR, "genesis.json.bak.1"),
    );
    expect(resolveConfigBackupFilePath(CONFIG_PATH, "../../genesis.json")).toBeNull();
  });
});

describe("listConfigBackups", () => {
  it("skips missing backups and sorts newest first", async () => {
    const fs = createStatFs({
      [path.join(BACKUP_DIR, "genesis.json.bak")]: { size: 30, mtimeMs: 300 },
      [path.join(BACKUP_DIR, "genesis.json.bak.2")]: { size: 10, mtimeMs: 100 },
      [path.join(BACKUP_DIR, "genesis.json.last-good")]: { size: 20, mtimeMs: 200.6 },
    });

    const result = await listConfigBackups(CONFIG_PATH, fs);

    expect(result.dir).toBe(BACKUP_DIR);
    expect(result.entries).toEqual([
      { id: "bak", bytes: 30, modifiedAt: 300 },
      { id: "last-good", bytes: 20, modifiedAt: 201 },
      { id: "bak.2", bytes: 10, modifiedAt: 100 },
    ]);
  });
});
