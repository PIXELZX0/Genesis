import { resolveLivePluginConfigObject } from "genesis/plugin-sdk/config-runtime";
import {
  definePluginEntry,
  type AnyAgentTool,
  type GenesisPluginApi,
} from "genesis/plugin-sdk/plugin-entry";
import { resolveApiKeyForProvider } from "genesis/plugin-sdk/provider-auth-runtime";
import { createSubsystemLogger } from "genesis/plugin-sdk/runtime-env";
import { z } from "zod";
import {
  evaluateWithJev,
  JEV_BACKEND_ORDER,
  type JevBackend,
  type JevQuestion,
} from "./jev-client.js";
import { decideModelCallRoute, jevRouterConfigSchema } from "./jev-router.js";
import { createJevEvaluateTool } from "./jev-tool.js";

const log = createSubsystemLogger("agents/jev-router");

const pluginConfigSchema = z.object({
  apiKey: z.string().trim().min(1).optional(),
  backend: z.enum(["auto", ...JEV_BACKEND_ORDER]).default("auto"),
  jevRouter: jevRouterConfigSchema,
});

type JevConnection = { backend: JevBackend; apiKey: string };

async function resolveBackendKey(
  api: GenesisPluginApi,
  backend: JevBackend,
  configuredKey: string | undefined,
): Promise<string | undefined> {
  if (backend === "typesafe" && configuredKey) {
    return configuredKey;
  }
  try {
    // "typesafe" resolves TYPESAFE_API_KEY / auth profiles; the others reuse the provider plugins' keys.
    return (await resolveApiKeyForProvider({ provider: backend, cfg: api.config })).apiKey;
  } catch {
    return undefined;
  }
}

async function resolveConnection(
  api: GenesisPluginApi,
  config: z.output<typeof pluginConfigSchema>,
): Promise<JevConnection | undefined> {
  const candidates = config.backend === "auto" ? JEV_BACKEND_ORDER : [config.backend];
  for (const backend of candidates) {
    const apiKey = await resolveBackendKey(api, backend, config.apiKey);
    if (apiKey) {
      return { backend, apiKey };
    }
  }
  return undefined;
}

export default definePluginEntry({
  id: "typesafe",
  name: "TypeSafe Jev",
  description: "TypeSafe Jev evaluation tool and model-call router",
  register(api) {
    const parseConfig = (raw: unknown) => {
      const parsed = pluginConfigSchema.safeParse(raw ?? {});
      if (!parsed.success) {
        log.warn(`Invalid typesafe plugin config; Jev disabled: ${parsed.error.message}`);
      }
      return parsed.success ? parsed.data : undefined;
    };
    // Live lookup so backend/threshold edits and turning the router off apply without a restart.
    const resolveCurrentConfig = () =>
      parseConfig(
        resolveLivePluginConfigObject(
          api.runtime.config?.loadConfig,
          "typesafe",
          api.pluginConfig as Record<string, unknown>,
        ),
      );
    const evaluate = async (
      state: unknown,
      questions: Record<string, JevQuestion>,
      opts: { signal?: AbortSignal; timeoutMs?: number } = {},
    ) => {
      const config = resolveCurrentConfig();
      const connection = config && (await resolveConnection(api, config));
      if (!connection) {
        throw new Error(
          "No Jev backend key found. Set TYPESAFE_API_KEY, OPENROUTER_API_KEY, or AI_GATEWAY_API_KEY.",
        );
      }
      return evaluateWithJev({ ...connection, state, questions, ...opts });
    };

    // Optional: only exposed when allowlisted (tools.alsoAllow: ["jev_evaluate"]).
    api.registerTool(
      () =>
        createJevEvaluateTool((state, questions, signal) =>
          evaluate(state, questions, { signal }),
        ) as unknown as AnyAgentTool,
      { names: ["jev_evaluate"], optional: true },
    );

    // Registering before_model_call pins isolated runs to the parent runtime, so only
    // register when the router is on at startup; turning it on later needs a restart.
    if (!parseConfig(api.pluginConfig)?.jevRouter.enabled) {
      return;
    }
    // Consecutive model-free tool calls per run; bounds loops driven by tool output.
    const directCalls = new Map<string, number>();
    api.on("before_model_call", async (event) => {
      const router = resolveCurrentConfig()?.jevRouter;
      if (!router?.enabled) {
        return { action: "pass" };
      }
      const used = directCalls.get(event.runId) ?? 0;
      try {
        const route = await decideModelCallRoute({
          messages: event.messages,
          tools: event.tools,
          config: router,
          allowDirectCall: used < router.maxConsecutiveDirectCalls,
          evaluate: (state, questions) =>
            evaluate(state, questions, { timeoutMs: router.timeoutMs }),
        });
        if (route.action === "tool_call") {
          directCalls.set(event.runId, used + 1);
        } else {
          directCalls.delete(event.runId);
        }
        log.debug(`jev route run=${event.runId} ${JSON.stringify(route)}`);
        return route;
      } catch (err) {
        log.warn(`Jev routing failed; using the model directly: ${String(err)}`);
        return { action: "pass" };
      }
    });
    api.on("agent_end", (_event, ctx) => {
      if (ctx.runId) {
        directCalls.delete(ctx.runId);
      }
    });
  },
});
