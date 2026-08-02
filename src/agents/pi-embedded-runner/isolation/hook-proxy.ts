import type {
  PluginHookAgentContext,
  PluginHookAgentEndEvent,
  PluginHookBeforePromptBuildEvent,
  PluginHookBeforePromptBuildResult,
} from "../../../plugins/hook-types.js";
import type { EmbeddedAttemptHookRunner } from "../run/types.js";
import type { PiIsolationBridgedHookName } from "./protocol.js";

type HookProxyFrame =
  | {
      type: "hook_request";
      requestId: string;
      hookName: "before_prompt_build";
      event: PluginHookBeforePromptBuildEvent;
      context: PluginHookAgentContext;
    }
  | {
      type: "hook_notification";
      hookName: "agent_end";
      event: PluginHookAgentEndEvent;
      context: PluginHookAgentContext;
    };

type PendingHookRequest = {
  resolve: (result: PluginHookBeforePromptBuildResult | undefined) => void;
  reject: (error: Error) => void;
};

export function createPiIsolationHookProxyBridge(params: {
  activeHookNames: readonly PiIsolationBridgedHookName[];
  send: (frame: HookProxyFrame) => Promise<void>;
}) {
  const activeHookNames = new Set(params.activeHookNames);
  const pending = new Map<string, PendingHookRequest>();
  let nextRequestId = 0;

  const hookRunner: EmbeddedAttemptHookRunner = {
    hasHooks: (hookName) => activeHookNames.has(hookName as PiIsolationBridgedHookName),
    runBeforePromptBuild: async (event, context) => {
      if (!activeHookNames.has("before_prompt_build")) {
        return undefined;
      }
      const requestId = `hook-${(nextRequestId += 1)}`;
      return await new Promise<PluginHookBeforePromptBuildResult | undefined>((resolve, reject) => {
        pending.set(requestId, { resolve, reject });
        params
          .send({
            type: "hook_request",
            requestId,
            hookName: "before_prompt_build",
            event,
            context,
          })
          .catch((error) => {
            pending.delete(requestId);
            reject(error instanceof Error ? error : new Error(String(error)));
          });
      });
    },
    runAgentEnd: async (event, context) => {
      if (!activeHookNames.has("agent_end")) {
        return;
      }
      await params.send({
        type: "hook_notification",
        hookName: "agent_end",
        event,
        context,
      });
    },
  };

  return {
    hookRunner,
    resolve(requestId: string, result: PluginHookBeforePromptBuildResult | undefined): boolean {
      const request = pending.get(requestId);
      if (!request) {
        return false;
      }
      pending.delete(requestId);
      request.resolve(result);
      return true;
    },
    reject(requestId: string, error: Error): boolean {
      const request = pending.get(requestId);
      if (!request) {
        return false;
      }
      pending.delete(requestId);
      request.reject(error);
      return true;
    },
    rejectAll(error: Error): void {
      for (const request of pending.values()) {
        request.reject(error);
      }
      pending.clear();
    },
  };
}
