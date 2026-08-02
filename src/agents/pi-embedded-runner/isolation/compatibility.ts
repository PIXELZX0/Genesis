import { getGlobalHookRunner } from "../../../plugins/hook-runner-global.js";
import type { PluginHookName } from "../../../plugins/hook-types.js";
import type { HookRunner } from "../../../plugins/hooks.js";
import { loadEmbeddedPiLspConfig } from "../../embedded-pi-lsp.js";
import { resolveSandboxRuntimeStatus } from "../../sandbox/runtime-status.js";
import type { EmbeddedRunAttemptParams } from "../run/types.js";
import {
  PI_ISOLATION_BRIDGED_HOOK_NAMES,
  type PiIsolationBridgedHookName,
  type PiIsolationToolDescriptor,
} from "./protocol.js";

export type PiIsolationFallbackCode =
  | "context_engine"
  | "lifecycle_hook"
  | "legacy_prompt_hook"
  | "sandbox_tool_contract"
  | "bundle_mcp_contract"
  | "bundle_lsp_contract"
  | "tool_argument_adapter"
  | "tool_schema"
  | "non_serializable_attempt"
  | "disabled"
  | "child_unavailable";

export type PiIsolationCompatibility =
  | { compatible: true }
  | {
      compatible: false;
      code: PiIsolationFallbackCode;
      reason: string;
    };

const CHILD_INCOMPATIBLE_HOOKS = [
  "before_agent_start",
  "before_tool_call",
  "llm_input",
  "llm_output",
  "before_compaction",
  "after_compaction",
  "after_tool_call",
  "tool_result_persist",
  "before_message_write",
] as const satisfies readonly PluginHookName[];

type HookPresence = Pick<HookRunner, "hasHooks">;

export function resolvePiIsolationBridgedHookNames(
  hookRunner: HookPresence | null = getGlobalHookRunner(),
): PiIsolationBridgedHookName[] {
  return PI_ISOLATION_BRIDGED_HOOK_NAMES.filter((hookName) => hookRunner?.hasHooks(hookName));
}

export function resolvePiIsolationStaticCompatibility(
  params: EmbeddedRunAttemptParams,
  hookRunner: HookPresence | null = getGlobalHookRunner(),
): PiIsolationCompatibility {
  if (params.contextEngine && params.contextEngine.info.id !== "legacy") {
    return {
      compatible: false,
      code: "context_engine",
      reason: `context engine ${params.contextEngine.info.id} is process-local`,
    };
  }
  if (params.legacyBeforeAgentStartResult) {
    return {
      compatible: false,
      code: "legacy_prompt_hook",
      reason: "a legacy before_agent_start hook supplied process-local prompt state",
    };
  }
  const activeHook = CHILD_INCOMPATIBLE_HOOKS.find((hookName) => hookRunner?.hasHooks(hookName));
  if (activeHook) {
    return {
      compatible: false,
      code: "lifecycle_hook",
      reason: `plugin hook ${activeHook} requires the parent runtime`,
    };
  }
  const sandboxSessionKey =
    params.sandboxSessionKey?.trim() || params.sessionKey?.trim() || params.sessionId;
  if (
    resolveSandboxRuntimeStatus({
      cfg: params.config,
      sessionKey: sandboxSessionKey,
    }).sandboxed
  ) {
    return {
      compatible: false,
      code: "sandbox_tool_contract",
      reason: "sandbox filesystem bridges are process-local",
    };
  }
  if (!params.disableTools && Object.keys(params.config?.mcp?.servers ?? {}).length > 0) {
    return {
      compatible: false,
      code: "bundle_mcp_contract",
      reason: "configured MCP tools require a session-scoped in-process runtime",
    };
  }
  if (!params.disableTools) {
    const lsp = loadEmbeddedPiLspConfig({
      workspaceDir: params.workspaceDir,
      cfg: params.config,
    });
    if (Object.keys(lsp.lspServers).length > 0) {
      return {
        compatible: false,
        code: "bundle_lsp_contract",
        reason: "configured LSP tools require a session-scoped in-process runtime",
      };
    }
  }
  return { compatible: true };
}

export function resolvePiIsolationToolCompatibility(params: {
  descriptors: PiIsolationToolDescriptor[];
  hasArgumentAdapter: boolean;
  sandboxEnabled: boolean;
}): PiIsolationCompatibility {
  if (params.sandboxEnabled) {
    return {
      compatible: false,
      code: "sandbox_tool_contract",
      reason: "sandbox filesystem bridges are process-local",
    };
  }
  if (params.hasArgumentAdapter) {
    return {
      compatible: false,
      code: "tool_argument_adapter",
      reason: "a tool uses a process-local prepareArguments adapter",
    };
  }
  return { compatible: true };
}

export function clonePiIsolationAttempt(
  params: EmbeddedRunAttemptParams,
):
  | { ok: true; attempt: Record<string, unknown> }
  | { ok: false; compatibility: PiIsolationCompatibility & { compatible: false } } {
  const {
    contextEngine: _contextEngine,
    authStorage: _authStorage,
    modelRegistry: _modelRegistry,
    runtimePlan: _runtimePlan,
    abortSignal: _abortSignal,
    replyOperation: _replyOperation,
    shouldEmitToolResult: _shouldEmitToolResult,
    shouldEmitToolOutput: _shouldEmitToolOutput,
    onPartialReply: _onPartialReply,
    onAssistantMessageStart: _onAssistantMessageStart,
    onBlockReply: _onBlockReply,
    onBlockReplyFlush: _onBlockReplyFlush,
    onReasoningStream: _onReasoningStream,
    onReasoningEnd: _onReasoningEnd,
    onToolResult: _onToolResult,
    onAgentEvent: _onAgentEvent,
    hasRepliedRef: _hasRepliedRef,
    isolatedToolBridge: _isolatedToolBridge,
    isolatedHookRunner: _isolatedHookRunner,
    ...wireAttempt
  } = params;
  try {
    const serialized = JSON.stringify(wireAttempt, (_key, value: unknown) => {
      if (typeof value === "function" || typeof value === "symbol" || typeof value === "bigint") {
        throw new TypeError(`unsupported ${typeof value} value`);
      }
      return value;
    });
    const parsed = JSON.parse(serialized) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new TypeError("attempt did not serialize to an object");
    }
    return { ok: true, attempt: parsed as Record<string, unknown> };
  } catch (error) {
    return {
      ok: false,
      compatibility: {
        compatible: false,
        code: "non_serializable_attempt",
        reason: `attempt parameters are not JSON serializable: ${error instanceof Error ? error.message : String(error)}`,
      },
    };
  }
}
