import { resolveAgentDir, resolveDefaultAgentId } from "../../agents/agent-scope.js";
import {
  type AuthProfileStore,
  ensureAuthProfileStore,
  resolveAuthStatePathForDisplay,
  setAuthProfileOrder,
} from "../../agents/auth-profiles.js";
import { normalizeProviderId } from "../../agents/model-selection.js";
import { resolveProviderIdForAuth } from "../../agents/provider-auth-aliases.js";
import { type RuntimeEnv, writeRuntimeJson } from "../../runtime.js";
import { normalizeStringEntries } from "../../shared/string-normalization.js";
import { shortenHomePath } from "../../utils.js";
import { loadModelsConfig } from "./load-config.js";
import { resolveKnownAgentId } from "./shared.js";

function resolveTargetAgent(
  cfg: Awaited<ReturnType<typeof loadModelsConfig>>,
  raw?: string,
): {
  agentId: string;
  agentDir: string;
} {
  const agentId = resolveKnownAgentId({ cfg, rawAgentId: raw }) ?? resolveDefaultAgentId(cfg);
  const agentDir = resolveAgentDir(cfg, agentId);
  return { agentId, agentDir };
}

function describeOrder(store: AuthProfileStore, provider: string): string[] {
  const providerKey = normalizeProviderId(provider);
  const order = store.order?.[providerKey];
  return Array.isArray(order) ? order : [];
}

async function resolveAuthOrderContext(
  opts: { provider: string; agent?: string },
  runtime: RuntimeEnv,
) {
  const rawProvider = opts.provider?.trim();
  if (!rawProvider) {
    throw new Error("Missing --provider.");
  }
  const provider = normalizeProviderId(rawProvider);
  const cfg = await loadModelsConfig({ commandName: "models auth-order", runtime });
  const { agentId, agentDir } = resolveTargetAgent(cfg, opts.agent);
  return { cfg, agentId, agentDir, provider };
}

export async function modelsAuthOrderGetCommand(
  opts: { provider: string; agent?: string; json?: boolean },
  runtime: RuntimeEnv,
) {
  const { agentId, agentDir, provider } = await resolveAuthOrderContext(opts, runtime);
  const store = ensureAuthProfileStore(agentDir, {
    allowKeychainPrompt: false,
  });
  const order = describeOrder(store, provider);

  if (opts.json) {
    writeRuntimeJson(runtime, {
      agentId,
      agentDir,
      provider,
      authStatePath: shortenHomePath(resolveAuthStatePathForDisplay(agentDir)),
      order: order.length > 0 ? order : null,
    });
    return;
  }

  runtime.log(`Agent: ${agentId}`);
  runtime.log(`Provider: ${provider}`);
  runtime.log(`Auth state file: ${shortenHomePath(resolveAuthStatePathForDisplay(agentDir))}`);
  runtime.log(order.length > 0 ? `Order override: ${order.join(", ")}` : "Order override: (none)");
}

export async function modelsAuthOrderClearCommand(
  opts: { provider: string; agent?: string },
  runtime: RuntimeEnv,
) {
  const { agentId, agentDir, provider } = await resolveAuthOrderContext(opts, runtime);
  const updated = await setAuthProfileOrder({
    agentDir,
    provider,
    order: null,
  });
  if (!updated) {
    throw new Error("Failed to update auth-state.json (lock busy?).");
  }

  runtime.log(`Agent: ${agentId}`);
  runtime.log(`Provider: ${provider}`);
  runtime.log("Cleared per-agent order override.");
}

const PRIORITY_UNSET = Number.NEGATIVE_INFINITY;

/**
 * Resolve a profile's effective priority for ordering. Mirrors the resolver's
 * precedence: secret-side `credential.priority` wins, then state-side
 * `priorities.<id>`, then config-side. Falls back to `-Infinity` so the row
 * sorts to the bottom of its tier.
 */
function resolveOrderPriority(
  profileId: string,
  store: AuthProfileStore,
  cfg: Awaited<ReturnType<typeof loadModelsConfig>>,
): number {
  const credPriority = store.profiles[profileId]?.priority;
  if (typeof credPriority === "number" && Number.isFinite(credPriority)) {
    return credPriority;
  }
  const statePriority = store.priorities?.[profileId];
  if (typeof statePriority === "number" && Number.isFinite(statePriority)) {
    return statePriority;
  }
  const configPriority = cfg?.auth?.profiles?.[profileId]?.priority;
  if (typeof configPriority === "number" && Number.isFinite(configPriority)) {
    return configPriority;
  }
  return PRIORITY_UNSET;
}

/**
 * Append profiles that exist for the provider but were not mentioned in the
 * explicit `requested` list, sorted by priority desc. Stable for equal
 * priorities (preserves the existing store order). The caller still gets to
 * choose the *first* slots; the filler is for the tail.
 */
function fillByPriority(params: {
  requested: string[];
  store: AuthProfileStore;
  cfg: Awaited<ReturnType<typeof loadModelsConfig>>;
  provider: string;
}): string[] {
  const providerAuthKey = resolveProviderIdForAuth(params.provider, { config: params.cfg });
  const requestedSet = new Set(params.requested);
  const remaining: string[] = [];
  for (const [profileId, credential] of Object.entries(params.store.profiles)) {
    if (requestedSet.has(profileId)) {
      continue;
    }
    if (resolveProviderIdForAuth(credential.provider, { config: params.cfg }) !== providerAuthKey) {
      continue;
    }
    remaining.push(profileId);
  }
  remaining.toSorted(
    (a, b) =>
      resolveOrderPriority(b, params.store, params.cfg) -
      resolveOrderPriority(a, params.store, params.cfg),
  );
  return [...params.requested, ...remaining];
}

export async function modelsAuthOrderSetCommand(
  opts: {
    provider: string;
    agent?: string;
    order: string[];
    sortByPriority?: boolean;
  },
  runtime: RuntimeEnv,
) {
  const { agentId, agentDir, provider } = await resolveAuthOrderContext(opts, runtime);

  const store = ensureAuthProfileStore(agentDir, {
    allowKeychainPrompt: false,
  });
  const providerKey = provider;
  const requested = normalizeStringEntries(opts.order ?? []);
  if (requested.length === 0) {
    throw new Error("Missing profile ids. Provide one or more profile ids.");
  }

  for (const profileId of requested) {
    const cred = store.profiles[profileId];
    if (!cred) {
      throw new Error(`Auth profile "${profileId}" not found in ${agentDir}.`);
    }
    if (normalizeProviderId(cred.provider) !== providerKey) {
      throw new Error(`Auth profile "${profileId}" is for ${cred.provider}, not ${provider}.`);
    }
  }

  const finalOrder = opts.sortByPriority
    ? fillByPriority({
        requested,
        store,
        cfg: await loadModelsConfig({ commandName: "models auth-order", runtime }),
        provider,
      })
    : requested;

  const updated = await setAuthProfileOrder({
    agentDir,
    provider,
    order: finalOrder,
  });
  if (!updated) {
    throw new Error("Failed to update auth-state.json (lock busy?).");
  }

  runtime.log(`Agent: ${agentId}`);
  runtime.log(`Provider: ${provider}`);
  runtime.log(`Order override: ${describeOrder(updated, provider).join(", ")}`);
}
