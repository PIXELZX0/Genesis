import type { SystemPromptSectionOrderEntry } from "../config/system-prompt-sections.js";
import type { GenesisConfig } from "../config/types.genesis.js";
import { resolveAgentConfig } from "./agent-scope.js";

function trimNonEmpty(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function resolveSystemPromptOverride(params: {
  config?: GenesisConfig;
  agentId?: string;
}): string | undefined {
  const config = params.config;
  if (!config) {
    return undefined;
  }
  const agentOverride = trimNonEmpty(
    params.agentId ? resolveAgentConfig(config, params.agentId)?.systemPromptOverride : undefined,
  );
  if (agentOverride) {
    return agentOverride;
  }
  return trimNonEmpty(config.agents?.defaults?.systemPromptOverride);
}

/** Per-agent section order replaces the defaults list; an empty list means default order. */
export function resolveSystemPromptSectionOrder(params: {
  config?: GenesisConfig;
  agentId?: string;
}): SystemPromptSectionOrderEntry[] | undefined {
  const agentOrder =
    params.config && params.agentId
      ? resolveAgentConfig(params.config, params.agentId)?.systemPromptSectionOrder
      : undefined;
  const defaultsOrder = params.config?.agents?.defaults?.systemPromptSectionOrder;
  return agentOrder ?? (Array.isArray(defaultsOrder) ? defaultsOrder : undefined);
}
