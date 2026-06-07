import type {
  ChannelAccountSnapshot,
  ChannelRuntimeSurface,
} from "genesis/plugin-sdk/channel-contract";
import type { GenesisConfig } from "genesis/plugin-sdk/config-runtime";
import type { RuntimeEnv } from "genesis/plugin-sdk/runtime-env";

export type MonitorTelegramOpts = {
  token?: string;
  accountId?: string;
  config?: GenesisConfig;
  runtime?: RuntimeEnv;
  channelRuntime?: ChannelRuntimeSurface;
  abortSignal?: AbortSignal;
  useWebhook?: boolean;
  webhookPath?: string;
  webhookPort?: number;
  webhookSecret?: string;
  webhookHost?: string;
  proxyFetch?: typeof fetch;
  webhookUrl?: string;
  webhookCertPath?: string;
  setStatus?: (patch: Omit<ChannelAccountSnapshot, "accountId">) => void;
};

export type TelegramMonitorFn = (opts?: MonitorTelegramOpts) => Promise<void>;

/**
 * Severity-aware sink for Telegram polling diagnostics.
 *
 * The polling runner self-heals from wedged long-poll sockets by restarting and
 * rebuilding the transport; those events are routine and must not surface as
 * errors (see genesis#68128 / genesis#69787). Levels:
 * - `debug`: high-volume transport/cycle diagnostics (rebuilds, cycle finished).
 * - `warn`: recoverable degradation worth seeing (stall detected, restart notices).
 * - `error`: genuine failures only.
 *
 * Production wires this to the channel runtime sink (`RuntimeEnv` exposes only
 * `log`/`error`, so `debug` and `warn` both route to `runtime.log`). Tests inject
 * per-level spies.
 */
export type TelegramPollingLogger = {
  debug: (line: string) => void;
  warn: (line: string) => void;
  error: (line: string) => void;
};
