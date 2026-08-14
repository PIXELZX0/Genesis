import type { GenesisConfig } from "../config/types.genesis.js";
import { callGateway } from "../gateway/call.js";
import { isEmbeddedMode } from "../infra/embedded-mode.js";
import { getActiveRuntimeWebToolsMetadata } from "../secrets/runtime.js";
import { normalizeDeliveryContext } from "../utils/delivery-context.js";
import type { GatewayMessageChannel } from "../utils/message-channel.js";
import {
  resolveAgentConfig,
  resolveAgentWorkspaceDir,
  resolveSessionAgentIds,
} from "./agent-scope.js";
import { resolveGenesisPluginToolsForOptions } from "./genesis-plugin-tools.js";
import { applyNodesToolWorkspaceGuard } from "./genesis-tools.nodes-workspace-guard.js";
import {
  collectPresentGenesisTools,
  isUpdatePlanToolEnabledForGenesisTools,
} from "./genesis-tools.registration.js";
import type { SandboxFsBridge } from "./sandbox/fs-bridge.js";
import type { SpawnedToolContext } from "./spawned-context.js";
import type { ToolFsPolicy } from "./tool-fs-policy.js";
import { createAdvisorTool } from "./tools/advisor-tool.js";
import { createAgentsListTool } from "./tools/agents-list-tool.js";
import { createAgentsManageTool } from "./tools/agents-manage-tool.js";
import { createCanvasTool } from "./tools/canvas-tool.js";
import type { AnyAgentTool } from "./tools/common.js";
import { createContactsTool } from "./tools/contacts-tool.js";
import { createCronTool } from "./tools/cron-tool.js";
import { createEmbeddedCallGateway } from "./tools/embedded-gateway-stub.js";
import { createGatewayTool } from "./tools/gateway-tool.js";
import { createImageGenerateTool } from "./tools/image-generate-tool.js";
import { createImageTool } from "./tools/image-tool.js";
import { createMessageTool } from "./tools/message-tool.js";
import { createMusicGenerateTool } from "./tools/music-generate-tool.js";
import { createNodesTool } from "./tools/nodes-tool.js";
import { createPdfTool } from "./tools/pdf-tool.js";
import { createSessionStatusTool } from "./tools/session-status-tool.js";
import { createSessionsHistoryTool } from "./tools/sessions-history-tool.js";
import { createSessionsListTool } from "./tools/sessions-list-tool.js";
import { createSessionsSendTool } from "./tools/sessions-send-tool.js";
import { createSessionsSpawnTool } from "./tools/sessions-spawn-tool.js";
import { createSessionsYieldTool } from "./tools/sessions-yield-tool.js";
import { createSubagentsTool } from "./tools/subagents-tool.js";
import { createTtsTool } from "./tools/tts-tool.js";
import { createUpdatePlanTool } from "./tools/update-plan-tool.js";
import { createVideoGenerateTool } from "./tools/video-generate-tool.js";
import { createWebFetchTool, createWebSearchTool } from "./tools/web-tools.js";
import { resolveWorkspaceRoot } from "./workspace-dir.js";

type GenesisToolsDeps = {
  callGateway: typeof callGateway;
  config?: GenesisConfig;
};

const GENESIS_TOOL_NAMES = new Set([
  "canvas",
  "nodes",
  "cron",
  "message",
  "tts",
  "image_generate",
  "music_generate",
  "video_generate",
  "gateway",
  "agents_list",
  "agents_manage",
  "update_plan",
  "sessions_list",
  "sessions_history",
  "sessions_send",
  "sessions_spawn",
  "ask_advisor",
  "sessions_yield",
  "subagents",
  "session_status",
  "web_search",
  "web_fetch",
  "image",
  "pdf",
  "contacts",
]);

const CORE_TOOL_NAMES = new Set([
  "read",
  "write",
  "edit",
  "exec",
  "process",
  "apply_patch",
  ...GENESIS_TOOL_NAMES,
]);

const defaultGenesisToolsDeps: GenesisToolsDeps = {
  callGateway,
};

let genesisToolsDeps: GenesisToolsDeps = defaultGenesisToolsDeps;

export function createGenesisTools(
  options?: {
    sandboxBrowserBridgeUrl?: string;
    allowHostBrowserControl?: boolean;
    agentSessionKey?: string;
    agentChannel?: GatewayMessageChannel;
    agentAccountId?: string;
    /** Delivery target for topic/thread routing. */
    agentTo?: string;
    /** Thread/topic identifier for routing replies to the originating thread. */
    agentThreadId?: string | number;
    agentDir?: string;
    sandboxRoot?: string;
    sandboxContainerWorkdir?: string;
    sandboxFsBridge?: SandboxFsBridge;
    fsPolicy?: ToolFsPolicy;
    sandboxed?: boolean;
    config?: GenesisConfig;
    pluginToolAllowlist?: string[];
    /** Current channel ID for auto-threading. */
    currentChannelId?: string;
    /** Current thread timestamp for auto-threading. */
    currentThreadTs?: string;
    /** Current inbound message id for action fallbacks. */
    currentMessageId?: string | number;
    /** Reply-to mode for auto-threading. */
    replyToMode?: "off" | "first" | "all" | "batched";
    /** Mutable ref to track if a reply was sent (for "first" mode). */
    hasRepliedRef?: { value: boolean };
    /** If true, the model has native vision capability */
    modelHasVision?: boolean;
    /** Active model provider for provider-specific tool gating. */
    modelProvider?: string;
    /** Active model id for provider/model-specific tool gating. */
    modelId?: string;
    /** If true, nodes action="invoke" can call media-returning commands directly. */
    allowMediaInvokeCommands?: boolean;
    /** Explicit agent ID override for cron/hook sessions. */
    requesterAgentIdOverride?: string;
    /** Require explicit message targets (no implicit last-route sends). */
    requireExplicitMessageTarget?: boolean;
    /** If true, omit the message tool from the tool list. */
    disableMessageTool?: boolean;
    /** If true, skip plugin tool resolution and return only shipped core tools. */
    disablePluginTools?: boolean;
    /** Trusted sender id from inbound context (not tool args). */
    requesterSenderId?: string | null;
    /** Whether the requesting sender is an owner. */
    senderIsOwner?: boolean;
    /** Ephemeral session UUID — regenerated on /new and /reset. */
    sessionId?: string;
    /**
     * Workspace directory to pass to spawned subagents for inheritance.
     * Defaults to workspaceDir. Use this to pass the actual agent workspace when the
     * session itself is running in a copied-workspace sandbox (`ro` or `none`) so
     * subagents inherit the real workspace path instead of the sandbox copy.
     */
    spawnWorkspaceDir?: string;
    /** Callback invoked when sessions_yield tool is called. */
    onYield?: (message: string) => Promise<void> | void;
    /** Allow plugin tools for this tool set to late-bind the gateway subagent. */
    allowGatewaySubagentBinding?: boolean;
    /** Restrict construction to these exact tool names; empty means the legacy full surface. */
    toolAllowlist?: readonly string[];
  } & SpawnedToolContext,
): AnyAgentTool[] {
  const requestedToolNames =
    options?.toolAllowlist && options.toolAllowlist.length > 0
      ? new Set(options.toolAllowlist)
      : undefined;
  const shouldCreateTool = (name: string) =>
    requestedToolNames === undefined || requestedToolNames.has(name);
  const resolvedConfig = options?.config ?? genesisToolsDeps.config;
  const { sessionAgentId } = resolveSessionAgentIds({
    sessionKey: options?.agentSessionKey,
    config: resolvedConfig,
    agentId: options?.requesterAgentIdOverride,
  });
  // Fall back to the session agent workspace so plugin loading stays workspace-stable
  // even when a caller forgets to thread workspaceDir explicitly.
  const inferredWorkspaceDir =
    options?.workspaceDir || !resolvedConfig
      ? undefined
      : resolveAgentWorkspaceDir(resolvedConfig, sessionAgentId);
  const workspaceDir = resolveWorkspaceRoot(options?.workspaceDir ?? inferredWorkspaceDir);
  const spawnWorkspaceDir = resolveWorkspaceRoot(
    options?.spawnWorkspaceDir ?? options?.workspaceDir ?? inferredWorkspaceDir,
  );
  const advisorConfig =
    (resolvedConfig
      ? resolveAgentConfig(resolvedConfig, sessionAgentId)?.tools?.advisor
      : undefined) ?? resolvedConfig?.tools?.advisor;
  const advisorModel = advisorConfig?.model?.trim();
  const advisorEnabled = advisorConfig?.enabled === true && Boolean(advisorModel);
  const deliveryContext = normalizeDeliveryContext({
    channel: options?.agentChannel,
    to: options?.agentTo,
    accountId: options?.agentAccountId,
    threadId: options?.agentThreadId,
  });
  const runtimeWebTools = getActiveRuntimeWebToolsMetadata();
  const sandbox =
    options?.sandboxRoot && options?.sandboxFsBridge
      ? { root: options.sandboxRoot, bridge: options.sandboxFsBridge }
      : undefined;
  const imageTool =
    shouldCreateTool("image") && options?.agentDir?.trim()
      ? createImageTool({
          config: options?.config,
          agentDir: options.agentDir,
          workspaceDir,
          sandbox,
          fsPolicy: options?.fsPolicy,
          modelHasVision: options?.modelHasVision,
        })
      : null;
  const imageGenerateTool = shouldCreateTool("image_generate")
    ? createImageGenerateTool({
        config: options?.config,
        agentDir: options?.agentDir,
        workspaceDir,
        sandbox,
        fsPolicy: options?.fsPolicy,
      })
    : null;
  const videoGenerateTool = shouldCreateTool("video_generate")
    ? createVideoGenerateTool({
        config: options?.config,
        agentDir: options?.agentDir,
        agentSessionKey: options?.agentSessionKey,
        requesterOrigin: deliveryContext ?? undefined,
        workspaceDir,
        sandbox,
        fsPolicy: options?.fsPolicy,
      })
    : null;
  const musicGenerateTool = shouldCreateTool("music_generate")
    ? createMusicGenerateTool({
        config: options?.config,
        agentDir: options?.agentDir,
        agentSessionKey: options?.agentSessionKey,
        requesterOrigin: deliveryContext ?? undefined,
        workspaceDir,
        sandbox,
        fsPolicy: options?.fsPolicy,
      })
    : null;
  const pdfTool =
    shouldCreateTool("pdf") && options?.agentDir?.trim()
      ? createPdfTool({
          config: options?.config,
          agentDir: options.agentDir,
          workspaceDir,
          sandbox,
          fsPolicy: options?.fsPolicy,
        })
      : null;
  const contactsTool =
    shouldCreateTool("contacts") && options?.agentDir?.trim()
      ? createContactsTool({
          agentDir: options.agentDir,
          config: resolvedConfig,
        })
      : null;
  const webSearchTool = shouldCreateTool("web_search")
    ? createWebSearchTool({
        config: options?.config,
        sandboxed: options?.sandboxed,
        runtimeWebSearch: runtimeWebTools?.search,
      })
    : null;
  const webFetchTool = shouldCreateTool("web_fetch")
    ? createWebFetchTool({
        config: options?.config,
        sandboxed: options?.sandboxed,
        runtimeWebFetch: runtimeWebTools?.fetch,
      })
    : null;
  const embedded = isEmbeddedMode();
  const messageTool = options?.disableMessageTool
    ? null
    : shouldCreateTool("message")
      ? createMessageTool({
          agentAccountId: options?.agentAccountId,
          agentSessionKey: options?.agentSessionKey,
          sessionId: options?.sessionId,
          config: options?.config,
          currentChannelId: options?.currentChannelId,
          currentChannelProvider: options?.agentChannel,
          currentThreadTs: options?.currentThreadTs,
          currentMessageId: options?.currentMessageId,
          replyToMode: options?.replyToMode,
          hasRepliedRef: options?.hasRepliedRef,
          sandboxRoot: options?.sandboxRoot,
          requireExplicitTarget: options?.requireExplicitMessageTarget,
          requesterSenderId: options?.requesterSenderId ?? undefined,
          senderIsOwner: options?.senderIsOwner,
        })
      : null;
  const nodesTool = shouldCreateTool("nodes")
    ? applyNodesToolWorkspaceGuard(
        createNodesTool({
          agentSessionKey: options?.agentSessionKey,
          agentChannel: options?.agentChannel,
          agentAccountId: options?.agentAccountId,
          currentChannelId: options?.currentChannelId,
          currentThreadTs: options?.currentThreadTs,
          config: options?.config,
          modelHasVision: options?.modelHasVision,
          allowMediaInvokeCommands: options?.allowMediaInvokeCommands,
        }),
        {
          fsPolicy: options?.fsPolicy,
          sandboxContainerWorkdir: options?.sandboxContainerWorkdir,
          sandboxRoot: options?.sandboxRoot,
          workspaceDir,
        },
      )
    : null;
  const effectiveCallGateway = embedded
    ? createEmbeddedCallGateway()
    : genesisToolsDeps.callGateway;
  const tools: AnyAgentTool[] = [
    ...(embedded
      ? []
      : [
          ...(shouldCreateTool("canvas")
            ? [createCanvasTool({ config: options?.config, workspaceDir })]
            : []),
          ...(nodesTool ? [nodesTool] : []),
          ...(shouldCreateTool("cron")
            ? [
                createCronTool({
                  agentSessionKey: options?.agentSessionKey,
                }),
              ]
            : []),
        ]),
    ...(!embedded && messageTool ? [messageTool] : []),
    ...(shouldCreateTool("tts")
      ? [
          createTtsTool({
            agentChannel: options?.agentChannel,
            config: resolvedConfig,
          }),
        ]
      : []),
    ...collectPresentGenesisTools([imageGenerateTool, musicGenerateTool, videoGenerateTool]),
    ...(!embedded && shouldCreateTool("gateway")
      ? [
          createGatewayTool({
            agentSessionKey: options?.agentSessionKey,
            config: options?.config,
          }),
        ]
      : []),
    ...(shouldCreateTool("agents_list")
      ? [
          createAgentsListTool({
            agentSessionKey: options?.agentSessionKey,
            requesterAgentIdOverride: options?.requesterAgentIdOverride,
          }),
        ]
      : []),
    ...(!embedded && shouldCreateTool("agents_manage") ? [createAgentsManageTool()] : []),
    ...(shouldCreateTool("update_plan") &&
    isUpdatePlanToolEnabledForGenesisTools({
      config: resolvedConfig,
      agentSessionKey: options?.agentSessionKey,
      agentId: options?.requesterAgentIdOverride,
      modelProvider: options?.modelProvider,
      modelId: options?.modelId,
    })
      ? [createUpdatePlanTool()]
      : []),
    ...(shouldCreateTool("sessions_list")
      ? [
          createSessionsListTool({
            agentSessionKey: options?.agentSessionKey,
            sandboxed: options?.sandboxed,
            config: resolvedConfig,
            callGateway: effectiveCallGateway,
          }),
        ]
      : []),
    ...(shouldCreateTool("sessions_history")
      ? [
          createSessionsHistoryTool({
            agentSessionKey: options?.agentSessionKey,
            sandboxed: options?.sandboxed,
            config: resolvedConfig,
            callGateway: effectiveCallGateway,
          }),
        ]
      : []),
    ...(embedded
      ? []
      : [
          ...(shouldCreateTool("sessions_send")
            ? [
                createSessionsSendTool({
                  agentSessionKey: options?.agentSessionKey,
                  agentChannel: options?.agentChannel,
                  sandboxed: options?.sandboxed,
                  config: resolvedConfig,
                  callGateway: genesisToolsDeps.callGateway,
                }),
              ]
            : []),
          ...(shouldCreateTool("sessions_spawn")
            ? [
                createSessionsSpawnTool({
                  agentSessionKey: options?.agentSessionKey,
                  agentChannel: options?.agentChannel,
                  agentAccountId: options?.agentAccountId,
                  agentTo: options?.agentTo,
                  agentThreadId: options?.agentThreadId,
                  agentGroupId: options?.agentGroupId,
                  agentGroupChannel: options?.agentGroupChannel,
                  agentGroupSpace: options?.agentGroupSpace,
                  agentMemberRoleIds: options?.agentMemberRoleIds,
                  sandboxed: options?.sandboxed,
                  requesterAgentIdOverride: options?.requesterAgentIdOverride,
                  workspaceDir: spawnWorkspaceDir,
                }),
              ]
            : []),
          ...(shouldCreateTool("ask_advisor") && advisorEnabled && advisorModel
            ? [
                createAdvisorTool({
                  model: advisorModel,
                  timeoutSeconds: advisorConfig?.timeoutSeconds,
                  agentSessionKey: options?.agentSessionKey,
                  agentChannel: options?.agentChannel,
                  agentAccountId: options?.agentAccountId,
                  agentTo: options?.agentTo,
                  agentThreadId: options?.agentThreadId,
                  agentGroupId: options?.agentGroupId,
                  agentGroupChannel: options?.agentGroupChannel,
                  agentGroupSpace: options?.agentGroupSpace,
                  agentMemberRoleIds: options?.agentMemberRoleIds,
                  requesterAgentIdOverride: options?.requesterAgentIdOverride,
                  workspaceDir: spawnWorkspaceDir,
                }),
              ]
            : []),
        ]),
    ...(shouldCreateTool("sessions_yield")
      ? [
          createSessionsYieldTool({
            sessionId: options?.sessionId,
            onYield: options?.onYield,
          }),
        ]
      : []),
    ...(shouldCreateTool("subagents")
      ? [
          createSubagentsTool({
            agentSessionKey: options?.agentSessionKey,
          }),
        ]
      : []),
    ...(shouldCreateTool("session_status")
      ? [
          createSessionStatusTool({
            agentSessionKey: options?.agentSessionKey,
            config: resolvedConfig,
            sandboxed: options?.sandboxed,
          }),
        ]
      : []),
    ...collectPresentGenesisTools([webSearchTool, webFetchTool, imageTool, pdfTool, contactsTool]),
  ];

  if (options?.disablePluginTools) {
    return tools;
  }

  const shouldResolvePluginTools =
    requestedToolNames === undefined ||
    Array.from(requestedToolNames).some((name) => !CORE_TOOL_NAMES.has(name));
  const wrappedPluginTools = shouldResolvePluginTools
    ? resolveGenesisPluginToolsForOptions({
        options: options
          ? {
              ...options,
              pluginToolAllowlist: [
                ...(options.pluginToolAllowlist ?? []),
                ...(options.toolAllowlist ?? []),
              ],
            }
          : options,
        resolvedConfig,
        existingToolNames: new Set(tools.map((tool) => tool.name)),
      }).filter((tool) => shouldCreateTool(tool.name))
    : [];

  return [...tools, ...wrappedPluginTools];
}

export const __testing = {
  setDepsForTest(overrides?: Partial<GenesisToolsDeps>) {
    genesisToolsDeps = overrides
      ? {
          ...defaultGenesisToolsDeps,
          ...overrides,
        }
      : defaultGenesisToolsDeps;
  },
};
