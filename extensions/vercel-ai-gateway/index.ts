import type { AnyAgentTool, GenesisPluginApi } from "genesis/plugin-sdk/plugin-entry";
import { resolveApiKeyForProvider } from "genesis/plugin-sdk/provider-auth-runtime";
import { defineSingleProviderPluginEntry } from "genesis/plugin-sdk/provider-entry";
import { createSubsystemLogger } from "genesis/plugin-sdk/runtime-env";
import { evaluateWithJev } from "./jev-client.js";
import { decideModelCallRoute, jevRouterConfigSchema } from "./jev-router.js";
import { createJevEvaluateTool } from "./jev-tool.js";
import { VERCEL_AI_GATEWAY_PROVIDER_ID } from "./models.js";
import { applyVercelAiGatewayConfig, VERCEL_AI_GATEWAY_DEFAULT_MODEL_REF } from "./onboard.js";
import {
  buildStaticVercelAiGatewayProvider,
  buildVercelAiGatewayProvider,
} from "./provider-catalog.js";

const log = createSubsystemLogger("agents/jev-router");

async function resolveGatewayApiKey(api: GenesisPluginApi): Promise<string | undefined> {
  try {
    return (
      await resolveApiKeyForProvider({ provider: VERCEL_AI_GATEWAY_PROVIDER_ID, cfg: api.config })
    ).apiKey;
  } catch {
    return undefined;
  }
}

async function requireGatewayApiKey(api: GenesisPluginApi): Promise<string> {
  const apiKey = await resolveGatewayApiKey(api);
  if (!apiKey) {
    throw new Error("Vercel AI Gateway API key missing (set AI_GATEWAY_API_KEY).");
  }
  return apiKey;
}

function registerJev(api: GenesisPluginApi) {
  // Optional: only exposed when allowlisted (tools.alsoAllow: ["jev_evaluate"]).
  api.registerTool(
    () =>
      createJevEvaluateTool(async (state, questions, signal) =>
        evaluateWithJev({ apiKey: await requireGatewayApiKey(api), state, questions, signal }),
      ) as unknown as AnyAgentTool,
    { names: ["jev_evaluate"], optional: true },
  );

  const parsed = jevRouterConfigSchema.safeParse(
    (api.pluginConfig as { jevRouter?: unknown } | undefined)?.jevRouter,
  );
  if (!parsed.success) {
    log.warn(`Invalid jevRouter config; router disabled: ${parsed.error.message}`);
    return;
  }
  const config = parsed.data;
  if (!config.enabled) {
    return;
  }

  // Consecutive model-free tool calls per run; bounds loops driven by tool output.
  const directCalls = new Map<string, number>();
  api.on("before_model_call", async (event) => {
    const apiKey = await resolveGatewayApiKey(api);
    if (!apiKey) {
      return { action: "pass" };
    }
    const used = directCalls.get(event.runId) ?? 0;
    try {
      const route = await decideModelCallRoute({
        messages: event.messages,
        tools: event.tools,
        config,
        allowDirectCall: used < config.maxConsecutiveDirectCalls,
        evaluate: (state, questions) =>
          evaluateWithJev({ apiKey, state, questions, timeoutMs: config.timeoutMs }),
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
}

export default defineSingleProviderPluginEntry({
  id: VERCEL_AI_GATEWAY_PROVIDER_ID,
  name: "Vercel AI Gateway Provider",
  description: "Bundled Vercel AI Gateway provider plugin",
  provider: {
    label: "Vercel AI Gateway",
    docsPath: "/providers/vercel-ai-gateway",
    auth: [
      {
        methodId: "api-key",
        label: "Vercel AI Gateway API key",
        hint: "API key",
        optionKey: "aiGatewayApiKey",
        flagName: "--ai-gateway-api-key",
        envVar: "AI_GATEWAY_API_KEY",
        promptMessage: "Enter Vercel AI Gateway API key",
        defaultModel: VERCEL_AI_GATEWAY_DEFAULT_MODEL_REF,
        applyConfig: (cfg) => applyVercelAiGatewayConfig(cfg),
        wizard: {
          choiceId: "ai-gateway-api-key",
          groupId: "ai-gateway",
        },
      },
    ],
    catalog: {
      buildProvider: buildVercelAiGatewayProvider,
      buildStaticProvider: buildStaticVercelAiGatewayProvider,
    },
  },
  register: registerJev,
});
