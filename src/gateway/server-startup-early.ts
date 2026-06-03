import { registerSkillsChangeListener } from "../agents/skills/refresh.js";
import type { GatewayTailscaleMode } from "../config/types.gateway.js";
import type { GenesisConfig } from "../config/types.genesis.js";
import { getMachineDisplayName } from "../infra/machine-name.js";
import {
  primeRemoteSkillsCache,
  refreshRemoteBinsForConnectedNodes,
  setSkillsRemoteRegistry,
} from "../infra/skills-remote.js";
import type { PluginRegistry } from "../plugins/registry-types.js";
import { startTaskRegistryMaintenance } from "../tasks/task-registry.maintenance.js";
import { resolveControlUiLinks } from "./control-ui-links.js";
import { normalizeControlUiBasePath } from "./control-ui-shared.js";
import { startGatewayDiscovery } from "./server-discovery-runtime.js";
import { startGatewayMaintenanceTimers } from "./server-maintenance.js";
import { setMcpRuntime } from "./server-methods/mcp.js";

const MCP_OAUTH_CLIENT_ID = "genesis-control-ui";

/**
 * Resolve the externally reachable Gateway web origin (plus Control UI base
 * path) used to build the MCP OAuth redirect URI. Prefers an explicit override,
 * then a configured remote URL, then the local Control UI link.
 */
function resolveGatewayWebUrl(cfg: GenesisConfig, port: number): string {
  const envOverride = process.env.GENESIS_GATEWAY_WEB_URL?.trim();
  if (envOverride) {
    return envOverride.replace(/\/+$/, "");
  }
  const remoteUrl = cfg.gateway?.mode === "remote" ? cfg.gateway?.remote?.url?.trim() : undefined;
  if (remoteUrl) {
    try {
      const parsed = new URL(remoteUrl);
      const httpProtocol =
        parsed.protocol === "wss:"
          ? "https:"
          : parsed.protocol === "ws:"
            ? "http:"
            : parsed.protocol;
      const basePath = normalizeControlUiBasePath(cfg.daemon?.controlUi?.basePath);
      return `${httpProtocol}//${parsed.host}${basePath}`;
    } catch {
      // fall through to local resolution
    }
  }
  const links = resolveControlUiLinks({
    port,
    bind: cfg.gateway?.bind,
    customBindHost: cfg.gateway?.customBindHost,
    basePath: cfg.daemon?.controlUi?.basePath,
  });
  return links.httpUrl.replace(/\/+$/, "");
}

export async function startGatewayEarlyRuntime(params: {
  minimalTestGateway: boolean;
  cfgAtStart: GenesisConfig;
  port: number;
  gatewayTls: { enabled: boolean; fingerprintSha256?: string };
  tailscaleMode: GatewayTailscaleMode;
  log: {
    info: (msg: string) => void;
    warn: (msg: string) => void;
  };
  logDiscovery: {
    info: (msg: string) => void;
    warn: (msg: string) => void;
  };
  nodeRegistry: Parameters<typeof setSkillsRemoteRegistry>[0];
  pluginRegistry?: PluginRegistry;
  broadcast: Parameters<typeof startGatewayMaintenanceTimers>[0]["broadcast"];
  nodeSendToAllSubscribed: Parameters<
    typeof startGatewayMaintenanceTimers
  >[0]["nodeSendToAllSubscribed"];
  getPresenceVersion: Parameters<typeof startGatewayMaintenanceTimers>[0]["getPresenceVersion"];
  getHealthVersion: Parameters<typeof startGatewayMaintenanceTimers>[0]["getHealthVersion"];
  refreshGatewayHealthSnapshot: Parameters<
    typeof startGatewayMaintenanceTimers
  >[0]["refreshGatewayHealthSnapshot"];
  logHealth: Parameters<typeof startGatewayMaintenanceTimers>[0]["logHealth"];
  dedupe: Parameters<typeof startGatewayMaintenanceTimers>[0]["dedupe"];
  chatAbortControllers: Parameters<typeof startGatewayMaintenanceTimers>[0]["chatAbortControllers"];
  chatRunState: Parameters<typeof startGatewayMaintenanceTimers>[0]["chatRunState"];
  chatRunBuffers: Parameters<typeof startGatewayMaintenanceTimers>[0]["chatRunBuffers"];
  chatDeltaSentAt: Parameters<typeof startGatewayMaintenanceTimers>[0]["chatDeltaSentAt"];
  chatDeltaLastBroadcastLen: Parameters<
    typeof startGatewayMaintenanceTimers
  >[0]["chatDeltaLastBroadcastLen"];
  removeChatRun: Parameters<typeof startGatewayMaintenanceTimers>[0]["removeChatRun"];
  agentRunSeq: Parameters<typeof startGatewayMaintenanceTimers>[0]["agentRunSeq"];
  nodeSendToSession: Parameters<typeof startGatewayMaintenanceTimers>[0]["nodeSendToSession"];
  mediaCleanupTtlMs?: number;
  skillsRefreshDelayMs: number;
  getSkillsRefreshTimer: () => ReturnType<typeof setTimeout> | null;
  setSkillsRefreshTimer: (timer: ReturnType<typeof setTimeout> | null) => void;
  loadConfig: () => GenesisConfig;
}) {
  let bonjourStop: (() => Promise<void>) | null = null;
  if (!params.minimalTestGateway) {
    const machineDisplayName = await getMachineDisplayName();
    const discovery = await startGatewayDiscovery({
      machineDisplayName,
      port: params.port,
      gatewayTls: params.gatewayTls.enabled
        ? { enabled: true, fingerprintSha256: params.gatewayTls.fingerprintSha256 }
        : undefined,
      wideAreaDiscoveryEnabled: params.cfgAtStart.discovery?.wideArea?.enabled === true,
      wideAreaDiscoveryDomain: params.cfgAtStart.discovery?.wideArea?.domain,
      tailscaleMode: params.tailscaleMode,
      mdnsMode: params.cfgAtStart.discovery?.mdns?.mode,
      gatewayDiscoveryServices: params.pluginRegistry?.gatewayDiscoveryServices,
      logDiscovery: params.logDiscovery,
    });
    bonjourStop = discovery.bonjourStop;
  }

  if (!params.minimalTestGateway) {
    setSkillsRemoteRegistry(params.nodeRegistry);
    void primeRemoteSkillsCache();
    startTaskRegistryMaintenance();
    // Wire the MCP OAuth runtime so `mcp.oauth.*` RPCs can build redirect URIs.
    // Without this the handlers short-circuit with UNAVAILABLE.
    try {
      setMcpRuntime({
        gatewayWebUrl: resolveGatewayWebUrl(params.cfgAtStart, params.port),
        resolveClientId: () => MCP_OAUTH_CLIENT_ID,
      });
    } catch (err) {
      params.log.warn(
        `mcp: failed to configure OAuth runtime: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  const skillsChangeUnsub = params.minimalTestGateway
    ? () => {}
    : registerSkillsChangeListener((event) => {
        if (event.reason === "remote-node") {
          return;
        }
        const existingTimer = params.getSkillsRefreshTimer();
        if (existingTimer) {
          clearTimeout(existingTimer);
        }
        const nextTimer = setTimeout(() => {
          params.setSkillsRefreshTimer(null);
          void refreshRemoteBinsForConnectedNodes(params.loadConfig());
        }, params.skillsRefreshDelayMs);
        params.setSkillsRefreshTimer(nextTimer);
      });

  const maintenance = params.minimalTestGateway
    ? null
    : startGatewayMaintenanceTimers({
        broadcast: params.broadcast,
        nodeSendToAllSubscribed: params.nodeSendToAllSubscribed,
        getPresenceVersion: params.getPresenceVersion,
        getHealthVersion: params.getHealthVersion,
        refreshGatewayHealthSnapshot: params.refreshGatewayHealthSnapshot,
        logHealth: params.logHealth,
        dedupe: params.dedupe,
        chatAbortControllers: params.chatAbortControllers,
        chatRunState: params.chatRunState,
        chatRunBuffers: params.chatRunBuffers,
        chatDeltaSentAt: params.chatDeltaSentAt,
        chatDeltaLastBroadcastLen: params.chatDeltaLastBroadcastLen,
        removeChatRun: params.removeChatRun,
        agentRunSeq: params.agentRunSeq,
        nodeSendToSession: params.nodeSendToSession,
        ...(typeof params.mediaCleanupTtlMs === "number"
          ? { mediaCleanupTtlMs: params.mediaCleanupTtlMs }
          : {}),
      });

  return {
    bonjourStop,
    skillsChangeUnsub,
    maintenance,
  };
}
