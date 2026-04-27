const COMMON_LIVE_ENV_NAMES = [
  "GENESIS_AGENT_RUNTIME",
  "GENESIS_CONFIG_PATH",
  "GENESIS_GATEWAY_TOKEN",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "GENESIS_SKIP_BROWSER_CONTROL_SERVER",
  "GENESIS_SKIP_CANVAS_HOST",
  "GENESIS_SKIP_CHANNELS",
  "GENESIS_SKIP_CRON",
  "GENESIS_SKIP_GMAIL_WATCHER",
  "GENESIS_STATE_DIR",
] as const;

export type LiveEnvSnapshot = Record<string, string | undefined>;

export function snapshotLiveEnv(extraNames: readonly string[] = []): LiveEnvSnapshot {
  const snapshot: LiveEnvSnapshot = {};
  for (const name of [...COMMON_LIVE_ENV_NAMES, ...extraNames]) {
    snapshot[name] = process.env[name];
  }
  return snapshot;
}

export function restoreLiveEnv(snapshot: LiveEnvSnapshot): void {
  for (const [name, value] of Object.entries(snapshot)) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
}
