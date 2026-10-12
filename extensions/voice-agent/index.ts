import { ErrorCodes, errorShape } from "genesis/plugin-sdk/browser-node-runtime";
import { formatErrorMessage } from "genesis/plugin-sdk/error-runtime";
import type { GatewayRequestHandlerOptions } from "genesis/plugin-sdk/gateway-runtime";
import { definePluginEntry, type GenesisPluginApi } from "genesis/plugin-sdk/plugin-entry";
import { normalizeOptionalString } from "genesis/plugin-sdk/text-runtime";
import { handleVoiceAgentAudioCommand, VOICE_AGENT_NODE_COMMAND } from "./src/audio-host.js";
import { resolveVoiceAgentConfig } from "./src/config.js";
import {
  createLocalAudioInvoke,
  createNodeAudioInvoke,
  resolveVoiceAgentSttProvider,
  startVoiceAgentSession,
  type VoiceAgentSession,
} from "./src/session.js";

const GATEWAY_TARGET = "gateway";
const AUTO_START_RETRY_MS = 15_000;

export default definePluginEntry({
  id: "voice-agent",
  name: "Voice Agent",
  description: "Talk to an agent through the gateway or a paired node's microphone and speaker.",
  register(api: GenesisPluginApi) {
    const config = resolveVoiceAgentConfig(api.pluginConfig);
    // One session per target (gateway host or node id).
    const sessions = new Map<string, VoiceAgentSession>();

    // Runs on node hosts (and is harmless on the gateway). Mic access requires the operator
    // to opt in via `gateway.nodes.allowCommands`.
    api.registerNodeHostCommand({
      command: VOICE_AGENT_NODE_COMMAND,
      cap: "voice-agent",
      handle: handleVoiceAgentAudioCommand,
    });

    const resolveNodeId = async (node: string) => {
      const { nodes } = await api.runtime.nodes.list({ connected: true });
      const match = nodes.find((entry) => entry.nodeId === node || entry.displayName === node);
      if (!match) {
        throw new Error(`node not connected: ${node}`);
      }
      return match.nodeId;
    };

    const start = async (node: string | undefined) => {
      const nodeId = node ? await resolveNodeId(node) : undefined;
      const target = nodeId ?? GATEWAY_TARGET;
      const existing = sessions.get(target);
      if (existing) {
        return existing.status();
      }
      const session = await startVoiceAgentSession({
        config,
        fullConfig: api.runtime.config.loadConfig(),
        runtime: api.runtime,
        logger: api.logger,
        target,
        invoke: nodeId ? createNodeAudioInvoke(api.runtime, nodeId) : createLocalAudioInvoke(),
        onStopped: () => sessions.delete(target),
      });
      sessions.set(target, session);
      return session.status();
    };

    const stopAll = async (target?: string) => {
      const targets = target ? [target] : [...sessions.keys()];
      await Promise.all(targets.map(async (key) => await sessions.get(key)?.stop()));
      return targets;
    };

    api.registerGatewayMethod(
      "voiceagent.start",
      async ({ params, respond }: GatewayRequestHandlerOptions) => {
        try {
          respond(true, await start(normalizeOptionalString(params?.node) ?? config.node));
        } catch (err) {
          respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatErrorMessage(err)));
        }
      },
    );
    api.registerGatewayMethod(
      "voiceagent.stop",
      async ({ params, respond }: GatewayRequestHandlerOptions) => {
        const node = normalizeOptionalString(params?.node);
        try {
          const target = node ? await resolveNodeId(node).catch(() => node) : undefined;
          respond(true, { stopped: await stopAll(target) });
        } catch (err) {
          respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatErrorMessage(err)));
        }
      },
    );
    api.registerGatewayMethod(
      "voiceagent.status",
      async ({ respond }: GatewayRequestHandlerOptions) => {
        respond(true, { sessions: [...sessions.values()].map((session) => session.status()) });
      },
      { scope: "operator.read" },
    );

    // The Control UI chat streams the browser mic straight to the STT provider with these
    // short-lived credentials; the provider API key never leaves the gateway.
    api.registerGatewayMethod(
      "voiceagent.browserSession",
      async ({ respond }: GatewayRequestHandlerOptions) => {
        try {
          const { provider, providerConfig } = resolveVoiceAgentSttProvider({
            config,
            fullConfig: api.runtime.config.loadConfig(),
          });
          if (!provider.createBrowserSession) {
            throw new Error(
              `realtime transcription provider "${provider.id}" has no browser sessions`,
            );
          }
          respond(true, await provider.createBrowserSession({ providerConfig }));
        } catch (err) {
          respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatErrorMessage(err)));
        }
      },
      { scope: "operator.write" },
    );

    let autoStartTimer: NodeJS.Timeout | undefined;
    api.registerService({
      id: "voice-agent",
      start: () => {
        if (!config.autoStart) {
          return;
        }
        // Nodes usually connect after the gateway boots, so keep retrying until it works.
        const attempt = () => {
          start(config.node).catch((err) => {
            api.logger.warn(`[voice-agent] auto-start failed: ${formatErrorMessage(err)}`);
            autoStartTimer = setTimeout(attempt, AUTO_START_RETRY_MS);
          });
        };
        attempt();
      },
      stop: async () => {
        clearTimeout(autoStartTimer);
        await stopAll();
      },
    });

    api.registerCli(
      async ({ program }) => {
        const { registerVoiceAgentCli } = await import("./src/cli.js");
        registerVoiceAgentCli(program);
      },
      {
        commands: ["voice-agent"],
        descriptors: [
          {
            name: "voice-agent",
            description: "Talk to an agent through gateway or node microphones",
            hasSubcommands: true,
          },
        ],
      },
    );
  },
});
