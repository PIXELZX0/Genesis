import process from "node:process";
import type {
  AgentToolResultMiddleware,
  AgentToolResultMiddlewareEvent,
  GenesisAgentToolResult,
} from "genesis/plugin-sdk/agent-harness";
import { createTokenjuiceGenesisEmbeddedExtension } from "./runtime-api.js";
import type { TokenjuiceGenesisPiRuntime } from "./tokenjuice-genesis.js";

type TokenjuiceToolResultHandler = (
  event: {
    toolName: string;
    input: Record<string, unknown>;
    content: GenesisAgentToolResult["content"];
    details: unknown;
    isError?: boolean;
  },
  ctx: { cwd: string },
) => Promise<Partial<GenesisAgentToolResult> | void> | Partial<GenesisAgentToolResult> | void;

function readCwd(event: AgentToolResultMiddlewareEvent): string {
  if (event.cwd?.trim()) {
    return event.cwd;
  }
  const workdir = event.args.workdir;
  if (typeof workdir === "string" && workdir.trim()) {
    return workdir;
  }
  return process.cwd();
}

async function loadTokenjuiceHandlers(): Promise<TokenjuiceToolResultHandler[]> {
  const handlers: TokenjuiceToolResultHandler[] = [];
  const createExtension = await createTokenjuiceGenesisEmbeddedExtension();
  const runtime: TokenjuiceGenesisPiRuntime = {
    on(event, handler) {
      if (event === "tool_result") {
        handlers.push(handler as TokenjuiceToolResultHandler);
      }
    },
  };
  createExtension(runtime);
  return handlers;
}

export function createTokenjuiceAgentToolResultMiddleware(): AgentToolResultMiddleware {
  let handlersPromise: Promise<TokenjuiceToolResultHandler[]> | undefined;
  const getHandlers = () => {
    handlersPromise ??= loadTokenjuiceHandlers();
    return handlersPromise;
  };

  return async (event) => {
    let current = event.result;
    for (const handler of await getHandlers()) {
      const next = await handler(
        {
          toolName: event.toolName,
          input: event.args,
          content: current.content,
          details: current.details,
          isError: event.isError,
        },
        { cwd: readCwd(event) },
      );
      if (next) {
        current = Object.assign({}, current, {
          content: next.content ?? current.content,
          details: next.details ?? current.details,
        });
      }
    }
    return current === event.result ? undefined : { result: current };
  };
}
