/**
 * Config backup listing for the control plane. The write path keeps a rotation
 * ring plus a `.last-good` copy under `config_backup/`; this exposes those as
 * restore candidates without ever handing their contents to the client.
 */

import nodeFs from "node:fs/promises";
import {
  CONFIG_BACKUP_COUNT,
  resolveConfigBackupDir,
  resolveConfigBackupPath,
} from "../../config/backup-rotation.js";

export type ConfigBackupEntry = {
  /** Backup suffix without the leading dot, e.g. `bak`, `bak.2`, `last-good`. */
  id: string;
  bytes: number;
  modifiedAt: number;
};

export type ConfigBackupStatFs = {
  stat: (path: string) => Promise<{ size: number; mtimeMs: number }>;
};

/** Restorable ids: the rotation ring plus the last known-good copy. */
export function listConfigBackupIds(): string[] {
  const ids = ["bak"];
  for (let index = 1; index <= CONFIG_BACKUP_COUNT - 1; index += 1) {
    ids.push(`bak.${index}`);
  }
  ids.push("last-good");
  return ids;
}

export function isConfigBackupId(id: string): boolean {
  return listConfigBackupIds().includes(id);
}

/**
 * Absolute path for a backup id, or null when the id is not one we hand out.
 * Rejecting unknown ids keeps client-supplied strings out of path joining.
 */
export function resolveConfigBackupFilePath(configPath: string, id: string): string | null {
  return isConfigBackupId(id) ? resolveConfigBackupPath(configPath, `.${id}`) : null;
}

export async function listConfigBackups(
  configPath: string,
  fs: ConfigBackupStatFs = nodeFs,
): Promise<{ dir: string; entries: ConfigBackupEntry[] }> {
  const entries: ConfigBackupEntry[] = [];
  for (const id of listConfigBackupIds()) {
    const filePath = resolveConfigBackupPath(configPath, `.${id}`);
    try {
      const stat = await fs.stat(filePath);
      entries.push({ id, bytes: stat.size, modifiedAt: Math.round(stat.mtimeMs) });
    } catch {
      // Missing backups are expected until the config has been written enough times.
    }
  }
  entries.sort((a, b) => b.modifiedAt - a.modifiedAt || a.id.localeCompare(b.id));
  return { dir: resolveConfigBackupDir(configPath), entries };
}
