import type { GatewayBrowserClient } from "../gateway.ts";

export type ConfigBackupEntry = {
  id: string;
  bytes: number;
  modifiedAt: number;
};

export type ConfigBackupsResult = {
  dir: string;
  entries: ConfigBackupEntry[];
};

export type ConfigBackupsState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  configBackups: ConfigBackupsResult | null;
  configBackupsLoading: boolean;
  configBackupsError: string | null;
  configBackupRestoreId: string | null;
  configSnapshot: { hash?: string | null } | null;
};

export async function loadConfigBackups(state: ConfigBackupsState): Promise<void> {
  if (!state.client || !state.connected || state.configBackupsLoading) {
    return;
  }
  state.configBackupsLoading = true;
  state.configBackupsError = null;
  try {
    state.configBackups = await state.client.request<ConfigBackupsResult>("config.backups", {});
  } catch (err) {
    state.configBackupsError = `Failed to list backups: ${String(err)}`;
  } finally {
    state.configBackupsLoading = false;
  }
}

/**
 * Restore a backup over the live config. The gateway rotates the current
 * config into the backup ring first, so this stays undoable.
 */
export async function restoreConfigBackup(
  state: ConfigBackupsState,
  id: string,
): Promise<{ ok: boolean }> {
  if (!state.client || !state.connected) {
    return { ok: false };
  }
  const baseHash = state.configSnapshot?.hash?.trim();
  state.configBackupsError = null;
  try {
    await state.client.request("config.backupRestore", {
      id,
      ...(baseHash ? { baseHash } : {}),
    });
    return { ok: true };
  } catch (err) {
    state.configBackupsError = `Failed to restore ${id}: ${String(err)}`;
    return { ok: false };
  }
}
