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
