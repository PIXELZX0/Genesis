import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { TSchema } from "typebox";
import type { AnyAgentTool } from "../../tools/common.js";
import type { PiIsolationToolDescriptor } from "./protocol.js";

type ToolProxyFrame =
  | {
      type: "tool_call";
      bridgeCallId: string;
      toolCallId: string;
      toolName: string;
      params: unknown;
    }
  | { type: "tool_abort"; bridgeCallId: string };

type PendingToolCall = {
  resolve: (result: AgentToolResult<unknown>) => void;
  reject: (error: Error) => void;
  onUpdate?: (update: AgentToolResult<unknown>) => void;
  removeAbortListener: () => void;
};

function createToolAbortError(signal?: AbortSignal): Error {
  const error = new Error("Tool call aborted", { cause: signal?.reason });
  error.name = "AbortError";
  return error;
}

export function createPiIsolationToolProxyBridge(params: {
  send: (frame: ToolProxyFrame) => Promise<void>;
}) {
  const pending = new Map<string, PendingToolCall>();
  let nextBridgeCallId = 0;

  const createTool = (descriptor: PiIsolationToolDescriptor): AnyAgentTool => ({
    name: descriptor.name,
    label: descriptor.label,
    description: descriptor.description,
    parameters: descriptor.parameters as TSchema,
    ...(descriptor.executionMode ? { executionMode: descriptor.executionMode } : {}),
    ...(descriptor.ownerOnly ? { ownerOnly: true } : {}),
    ...(descriptor.displaySummary ? { displaySummary: descriptor.displaySummary } : {}),
    execute: async (toolCallId, toolParams, signal, onUpdate) => {
      const bridgeCallId = `tool-${(nextBridgeCallId += 1)}`;
      return await new Promise<AgentToolResult<unknown>>((resolve, reject) => {
        let settled = false;
        const onAbort = () => {
          if (settled) {
            return;
          }
          settled = true;
          pending.delete(bridgeCallId);
          signal?.removeEventListener("abort", onAbort);
          void params.send({ type: "tool_abort", bridgeCallId }).catch(() => undefined);
          reject(createToolAbortError(signal));
        };
        if (signal?.aborted) {
          settled = true;
          reject(createToolAbortError(signal));
          return;
        }
        const removeAbortListener = () => signal?.removeEventListener("abort", onAbort);
        signal?.addEventListener("abort", onAbort, { once: true });
        pending.set(bridgeCallId, {
          resolve: (result) => {
            if (settled) {
              return;
            }
            settled = true;
            removeAbortListener();
            resolve(result);
          },
          reject: (error) => {
            if (settled) {
              return;
            }
            settled = true;
            removeAbortListener();
            reject(error);
          },
          onUpdate,
          removeAbortListener,
        });
        params
          .send({
            type: "tool_call",
            bridgeCallId,
            toolCallId,
            toolName: descriptor.name,
            params: toolParams,
          })
          .catch((error) => {
            pending.delete(bridgeCallId);
            removeAbortListener();
            if (settled) {
              return;
            }
            settled = true;
            reject(error instanceof Error ? error : new Error(String(error)));
          });
      });
    },
  });

  return {
    createTool,
    update(bridgeCallId: string, update: unknown): boolean {
      const call = pending.get(bridgeCallId);
      call?.onUpdate?.(update as AgentToolResult<unknown>);
      return Boolean(call);
    },
    resolve(bridgeCallId: string, result: unknown): boolean {
      const call = pending.get(bridgeCallId);
      if (!call) {
        return false;
      }
      pending.delete(bridgeCallId);
      call.resolve(result as AgentToolResult<unknown>);
      return true;
    },
    reject(bridgeCallId: string, error: Error): boolean {
      const call = pending.get(bridgeCallId);
      if (!call) {
        return false;
      }
      pending.delete(bridgeCallId);
      call.reject(error);
      return true;
    },
    rejectAll(error: Error): void {
      for (const call of pending.values()) {
        call.removeAbortListener();
        call.reject(error);
      }
      pending.clear();
    },
  };
}
