import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import {
  createDiagnosticTraceContext,
  freezeDiagnosticTraceContext,
  type DiagnosticTraceContext,
} from "../../../infra/diagnostic-trace-context.js";
import { getPluginToolMeta } from "../../../plugins/tools.js";
import type { AnyAgentTool } from "../../tools/common.js";
import { prepareEmbeddedAttemptToolRuntime } from "../run/attempt-tools.js";
import type { EmbeddedRunAttemptParams } from "../run/types.js";
import type { PiIsolationToolDescriptor } from "./protocol.js";

export type PiIsolationToolHost = {
  abortController: AbortController;
  trace: DiagnosticTraceContext;
  descriptors: PiIsolationToolDescriptor[];
  sandboxEnabled: boolean;
  hasArgumentAdapter: boolean;
  execute(params: {
    toolName: string;
    toolCallId: string;
    toolParams: unknown;
    signal: AbortSignal;
    onUpdate: (update: AgentToolResult<unknown>) => void;
  }): Promise<AgentToolResult<unknown>>;
};

export class PiIsolationToolContractError extends Error {
  readonly code = "PI_ISOLATION_TOOL_CONTRACT";

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "PiIsolationToolContractError";
  }
}

function cloneToolParameters(value: unknown): unknown {
  const serialized = JSON.stringify(value, (_key, nested: unknown) => {
    if (typeof nested === "function" || typeof nested === "symbol" || typeof nested === "bigint") {
      throw new TypeError(`tool schema contains an unsupported ${typeof nested} value`);
    }
    return nested;
  });
  if (serialized === undefined) {
    throw new TypeError("tool schema is undefined");
  }
  return JSON.parse(serialized) as unknown;
}

function describeTool(tool: AnyAgentTool): PiIsolationToolDescriptor {
  const pluginMeta = getPluginToolMeta(tool);
  try {
    return {
      name: tool.name,
      label: tool.label,
      description: tool.description ?? "",
      parameters: cloneToolParameters(tool.parameters),
      ...(tool.executionMode ? { executionMode: tool.executionMode } : {}),
      ...(tool.ownerOnly === true ? { ownerOnly: true } : {}),
      ...(tool.displaySummary ? { displaySummary: tool.displaySummary } : {}),
      ...(pluginMeta ? { pluginMeta } : {}),
    };
  } catch (error) {
    throw new PiIsolationToolContractError(
      `tool ${tool.name || "<unnamed>"} cannot cross the PI isolation boundary`,
      { cause: error },
    );
  }
}

export async function createPiIsolationToolHost(
  attempt: EmbeddedRunAttemptParams,
): Promise<PiIsolationToolHost> {
  const abortController = new AbortController();
  try {
    const trace = freezeDiagnosticTraceContext(createDiagnosticTraceContext());
    const runtime = await prepareEmbeddedAttemptToolRuntime({
      attempt,
      abortSignal: abortController.signal,
      trace,
      onYield: () => {
        throw new PiIsolationToolContractError(
          "sessions_yield must execute inside the PI isolation child",
        );
      },
      toolAllowlist: attempt.toolsAllow,
    });
    const toolsByName = new Map(runtime.toolsRaw.map((tool) => [tool.name, tool]));
    const descriptors = runtime.toolsRaw.map(describeTool);
    return {
      abortController,
      trace,
      descriptors,
      sandboxEnabled: runtime.sandbox?.enabled === true,
      hasArgumentAdapter: runtime.toolsRaw.some(
        (tool) => typeof (tool as { prepareArguments?: unknown }).prepareArguments === "function",
      ),
      async execute(params) {
        const tool = toolsByName.get(params.toolName);
        if (!tool) {
          throw new Error(`Unknown isolated PI tool: ${params.toolName}`);
        }
        return await tool.execute(
          params.toolCallId,
          params.toolParams,
          params.signal,
          params.onUpdate,
        );
      },
    };
  } catch (error) {
    abortController.abort(error);
    throw error;
  }
}
