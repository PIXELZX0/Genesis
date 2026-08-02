import fs from "node:fs/promises";
import type { DiagnosticTraceContext } from "../../../infra/diagnostic-trace-context.js";
import { extractModelCompat } from "../../../plugins/provider-model-compat.js";
import { isSubagentSessionKey } from "../../../routing/session-key.js";
import { resolveUserPath } from "../../../utils.js";
import { resolveGenesisAgentDir } from "../../agent-paths.js";
import { resolveSessionAgentIds } from "../../agent-scope.js";
import { resolveModelAuthMode } from "../../model-auth.js";
import { createGenesisCodingTools } from "../../pi-tools.js";
import { resolveSandboxContext } from "../../sandbox.js";
import type { AnyAgentTool } from "../../tools/common.js";
import { createSessionsYieldTool } from "../../tools/sessions-yield-tool.js";
import { resolveAttemptSpawnWorkspaceDir } from "./attempt.thread-helpers.js";
import { buildEmbeddedAttemptToolRunContext } from "./attempt.tool-run-context.js";
import type { EmbeddedRunAttemptParams } from "./types.js";

export function applyEmbeddedAttemptToolsAllow<T extends { name: string }>(
  tools: T[],
  toolsAllow?: string[],
): T[] {
  if (!toolsAllow || toolsAllow.length === 0) {
    return tools;
  }
  const allowSet = new Set(toolsAllow);
  return tools.filter((tool) => allowSet.has(tool.name));
}

export type EmbeddedAttemptToolContext = {
  resolvedWorkspace: string;
  effectiveWorkspace: string;
  sandboxSessionKey: string;
  sandbox: Awaited<ReturnType<typeof resolveSandboxContext>>;
  sessionAgentId: string;
  agentDir: string;
};

export async function prepareEmbeddedAttemptToolContext(
  attempt: EmbeddedRunAttemptParams,
): Promise<EmbeddedAttemptToolContext> {
  const resolvedWorkspace = resolveUserPath(attempt.workspaceDir);
  await fs.mkdir(resolvedWorkspace, { recursive: true });
  const sandboxSessionKey =
    attempt.sandboxSessionKey?.trim() || attempt.sessionKey?.trim() || attempt.sessionId;
  const sandbox = await resolveSandboxContext({
    config: attempt.config,
    sessionKey: sandboxSessionKey,
    workspaceDir: resolvedWorkspace,
  });
  const effectiveWorkspace = sandbox?.enabled
    ? sandbox.workspaceAccess === "rw"
      ? resolvedWorkspace
      : sandbox.workspaceDir
    : resolvedWorkspace;
  await fs.mkdir(effectiveWorkspace, { recursive: true });
  const { sessionAgentId } = resolveSessionAgentIds({
    sessionKey: attempt.sessionKey,
    config: attempt.config,
    agentId: attempt.agentId,
  });
  const agentDir = attempt.agentDir ?? resolveGenesisAgentDir();
  return {
    resolvedWorkspace,
    effectiveWorkspace,
    sandboxSessionKey,
    sandbox,
    sessionAgentId,
    agentDir,
  };
}

export function createEmbeddedAttemptTools(params: {
  attempt: EmbeddedRunAttemptParams;
  context: EmbeddedAttemptToolContext;
  abortSignal: AbortSignal;
  trace: DiagnosticTraceContext;
  onYield: (message: string) => void;
  toolAllowlist?: readonly string[];
}): AnyAgentTool[] {
  const attempt = params.attempt;
  const {
    resolvedWorkspace,
    effectiveWorkspace,
    sandboxSessionKey,
    sandbox,
    sessionAgentId,
    agentDir,
  } = params.context;
  return attempt.isolatedToolBridge
    ? materializeIsolatedAttemptTools({
        tools: attempt.isolatedToolBridge.tools,
        localToolNames: attempt.isolatedToolBridge.localToolNames,
        sessionId: attempt.sessionId,
        onYield: params.onYield,
      })
    : attempt.disableTools
      ? []
      : applyEmbeddedAttemptToolsAllow(
          createGenesisCodingTools({
            agentId: sessionAgentId,
            ...buildEmbeddedAttemptToolRunContext({ ...attempt, trace: params.trace }),
            exec: {
              ...attempt.execOverrides,
              elevated: attempt.bashElevated,
            },
            sandbox,
            messageProvider: attempt.messageChannel ?? attempt.messageProvider,
            agentAccountId: attempt.agentAccountId,
            messageTo: attempt.messageTo,
            messageThreadId: attempt.messageThreadId,
            groupId: attempt.groupId,
            groupChannel: attempt.groupChannel,
            groupSpace: attempt.groupSpace,
            memberRoleIds: attempt.memberRoleIds,
            spawnedBy: attempt.spawnedBy,
            senderId: attempt.senderId,
            senderName: attempt.senderName,
            senderUsername: attempt.senderUsername,
            senderE164: attempt.senderE164,
            senderIsOwner: attempt.senderIsOwner,
            allowGatewaySubagentBinding: attempt.allowGatewaySubagentBinding,
            sessionKey: sandboxSessionKey,
            sessionId: attempt.sessionId,
            runId: attempt.runId,
            agentDir,
            workspaceDir: effectiveWorkspace,
            spawnWorkspaceDir: resolveAttemptSpawnWorkspaceDir({
              sandbox,
              resolvedWorkspace,
            }),
            config: attempt.config,
            abortSignal: params.abortSignal,
            modelProvider: attempt.model.provider,
            modelId: attempt.modelId,
            modelCompat: extractModelCompat(attempt.model),
            modelApi: attempt.model.api,
            modelContextWindowTokens: attempt.model.contextWindow,
            modelAuthMode: resolveModelAuthMode(attempt.model.provider, attempt.config),
            currentChannelId: attempt.currentChannelId,
            currentThreadTs: attempt.currentThreadTs,
            currentMessageId: attempt.currentMessageId,
            replyToMode: attempt.replyToMode,
            hasRepliedRef: attempt.hasRepliedRef,
            modelHasVision: attempt.model.input?.includes("image") ?? false,
            requireExplicitMessageTarget:
              attempt.requireExplicitMessageTarget ?? isSubagentSessionKey(attempt.sessionKey),
            disableMessageTool: attempt.disableMessageTool,
            forceMessageTool: attempt.forceMessageTool,
            onYield: params.onYield,
            toolAllowlist: params.toolAllowlist,
          }),
          attempt.toolsAllow,
        );
}

export function materializeIsolatedAttemptTools(params: {
  tools: AnyAgentTool[];
  localToolNames?: readonly "sessions_yield"[];
  sessionId: string;
  onYield: (message: string) => void;
}): AnyAgentTool[] {
  const replaceSessionsYield =
    params.localToolNames?.includes("sessions_yield") === true ||
    params.tools.some((tool) => tool.name === "sessions_yield");
  if (!replaceSessionsYield) {
    return params.tools;
  }
  const localSessionsYield = createSessionsYieldTool({
    sessionId: params.sessionId,
    onYield: params.onYield,
  });
  let replaced = false;
  const tools = params.tools.map((tool) => {
    if (tool.name !== "sessions_yield") {
      return tool;
    }
    replaced = true;
    return {
      ...tool,
      execute: localSessionsYield.execute,
    };
  });
  return replaced ? tools : [...tools, localSessionsYield];
}

export async function prepareEmbeddedAttemptToolRuntime(params: {
  attempt: EmbeddedRunAttemptParams;
  abortSignal: AbortSignal;
  trace: DiagnosticTraceContext;
  onYield: (message: string) => void;
  toolAllowlist?: readonly string[];
}): Promise<EmbeddedAttemptToolContext & { toolsRaw: AnyAgentTool[] }> {
  const context = await prepareEmbeddedAttemptToolContext(params.attempt);
  return {
    ...context,
    toolsRaw: createEmbeddedAttemptTools({
      ...params,
      context,
    }),
  };
}
