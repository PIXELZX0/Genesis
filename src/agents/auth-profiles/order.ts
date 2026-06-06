import type { GenesisConfig } from "../../config/types.genesis.js";
import { resolveProviderIdForAuth } from "../provider-auth-aliases.js";
import { findNormalizedProviderValue, normalizeProviderId } from "../provider-id.js";
import {
  evaluateStoredCredentialEligibility,
  type AuthCredentialReasonCode,
} from "./credential-state.js";
import { dedupeProfileIds, listProfilesForProvider } from "./profile-list.js";
import type { AuthProfileStore } from "./types.js";
import {
  clearExpiredCooldowns,
  isProfileInCooldown,
  resolveProfileUnusableUntil,
} from "./usage-state.js";

export type AuthProfileEligibilityReasonCode =
  | AuthCredentialReasonCode
  | "profile_missing"
  | "provider_mismatch"
  | "mode_mismatch";

export type AuthProfileEligibility = {
  eligible: boolean;
  reasonCode: AuthProfileEligibilityReasonCode;
};

export function resolveAuthProfileEligibility(params: {
  cfg?: GenesisConfig;
  store: AuthProfileStore;
  provider: string;
  profileId: string;
  now?: number;
}): AuthProfileEligibility {
  const providerAuthKey = resolveProviderIdForAuth(params.provider, { config: params.cfg });
  const cred = params.store.profiles[params.profileId];
  if (!cred) {
    return { eligible: false, reasonCode: "profile_missing" };
  }
  if (resolveProviderIdForAuth(cred.provider, { config: params.cfg }) !== providerAuthKey) {
    return { eligible: false, reasonCode: "provider_mismatch" };
  }
  const profileConfig = params.cfg?.auth?.profiles?.[params.profileId];
  if (profileConfig) {
    if (
      resolveProviderIdForAuth(profileConfig.provider, { config: params.cfg }) !== providerAuthKey
    ) {
      return { eligible: false, reasonCode: "provider_mismatch" };
    }
    if (profileConfig.mode !== cred.type) {
      const oauthCompatible = profileConfig.mode === "oauth" && cred.type === "token";
      if (!oauthCompatible) {
        return { eligible: false, reasonCode: "mode_mismatch" };
      }
    }
  }
  const credentialEligibility = evaluateStoredCredentialEligibility({
    credential: cred,
    now: params.now,
  });
  return {
    eligible: credentialEligibility.eligible,
    reasonCode: credentialEligibility.reasonCode,
  };
}

export function resolveAuthProfileOrder(params: {
  cfg?: GenesisConfig;
  store: AuthProfileStore;
  provider: string;
  preferredProfile?: string;
}): string[] {
  const { cfg, store, provider, preferredProfile } = params;
  const providerKey = normalizeProviderId(provider);
  const providerAuthKey = resolveProviderIdForAuth(provider, { config: cfg });
  const now = Date.now();

  // Rotation precedence (highest priority wins, then falls through):
  // 1. `preferredProfile` (caller-pinned profile id, e.g. per-session override)
  // 2. Explicit `auth.order` (per-agent state or global config) — user-locked
  //    rotation, still cooldown-respected
  // 3. Priority-sorted candidates (new): profiles with `priority` (secret-side
  //    `credential.priority` or state-side `priorities.<id>`, secret wins) sort
  //    by `priority` desc; profiles without priority fall to the bottom within
  //    their tier; ties resolve by type (oauth > token > api_key) then
  //    `lastUsed` ascending (round-robin)
  // 4. Round-robin fallback (no priority, no explicit order)

  // Clear any cooldowns that have expired since the last check so profiles
  // get a fresh error count and are not immediately re-penalized on the
  // next transient failure. See #3604.
  clearExpiredCooldowns(store, now);
  const storedOrder =
    resolveAuthOrder(store.order, providerAuthKey) ?? resolveAuthOrder(store.order, providerKey);
  const configuredOrder =
    resolveAuthOrder(cfg?.auth?.order, providerAuthKey) ??
    resolveAuthOrder(cfg?.auth?.order, providerKey);
  const explicitOrder = storedOrder ?? configuredOrder;
  const explicitProfiles = cfg?.auth?.profiles
    ? Object.entries(cfg.auth.profiles)
        .filter(
          ([, profile]) =>
            resolveProviderIdForAuth(profile.provider, { config: cfg }) === providerAuthKey,
        )
        .map(([profileId]) => profileId)
    : [];
  const baseOrder =
    explicitOrder ??
    (explicitProfiles.length > 0 ? explicitProfiles : listProfilesForProvider(store, provider));
  if (baseOrder.length === 0) {
    return [];
  }

  const isValidProfile = (profileId: string): boolean =>
    resolveAuthProfileEligibility({
      cfg,
      store,
      provider,
      profileId,
      now,
    }).eligible;
  let filtered = baseOrder.filter(isValidProfile);

  // Repair config/store profile-id drift from older setup flows:
  // if configured profile ids no longer exist in auth-profiles.json, scan the
  // provider's stored credentials and use any valid entries.
  const allBaseProfilesMissing = baseOrder.every((profileId) => !store.profiles[profileId]);
  if (filtered.length === 0 && explicitProfiles.length > 0 && allBaseProfilesMissing) {
    const storeProfiles = listProfilesForProvider(store, provider);
    filtered = storeProfiles.filter(isValidProfile);
  }

  const deduped = dedupeProfileIds(filtered);

  // If user specified explicit order (store override or config), respect it
  // exactly, but still apply cooldown sorting to avoid repeatedly selecting
  // known-bad/rate-limited keys as the first candidate.
  if (explicitOrder && explicitOrder.length > 0) {
    // ...but still respect cooldown tracking to avoid repeatedly selecting a
    // known-bad/rate-limited key as the first candidate.
    const available: string[] = [];
    const inCooldown: Array<{ profileId: string; cooldownUntil: number }> = [];

    for (const profileId of deduped) {
      if (isProfileInCooldown(store, profileId)) {
        const cooldownUntil =
          resolveProfileUnusableUntil(store.usageStats?.[profileId] ?? {}) ?? now;
        inCooldown.push({ profileId, cooldownUntil });
      } else {
        available.push(profileId);
      }
    }

    const cooldownSorted = inCooldown
      .toSorted((a, b) => a.cooldownUntil - b.cooldownUntil)
      .map((entry) => entry.profileId);

    const ordered = [...available, ...cooldownSorted];

    // Still put preferredProfile first if specified
    if (preferredProfile && ordered.includes(preferredProfile)) {
      return [preferredProfile, ...ordered.filter((e) => e !== preferredProfile)];
    }
    return ordered;
  }

  // Otherwise, use round-robin: sort by lastUsed (oldest first)
  // preferredProfile goes first if specified (for explicit user choice)
  // lastGood is NOT prioritized - that would defeat round-robin
  const sorted = orderProfilesByMode(deduped, store, cfg);

  if (preferredProfile && sorted.includes(preferredProfile)) {
    return [preferredProfile, ...sorted.filter((e) => e !== preferredProfile)];
  }

  return sorted;
}

function resolveAuthOrder(
  order: Record<string, string[]> | undefined,
  provider: string,
): string[] | undefined {
  return findNormalizedProviderValue(order, provider);
}

function orderProfilesByMode(
  order: string[],
  store: AuthProfileStore,
  cfg?: GenesisConfig,
): string[] {
  const now = Date.now();

  // Partition into available and in-cooldown
  const available: string[] = [];
  const inCooldown: string[] = [];

  for (const profileId of order) {
    if (isProfileInCooldown(store, profileId)) {
      inCooldown.push(profileId);
    } else {
      available.push(profileId);
    }
  }

  // Sort available profiles. Primary key: priority (desc) so a user-set
  // `priority = 100` on a slow OAuth profile is tried before an unset token.
  // Unset priorities sort to the bottom within their tier — `undefined` is
  // treated as `-Infinity`. A `priority = 0` is "set" and counts above
  // undefined; it does not collapse to falsy.
  // Secondary: type (oauth > token > api_key). Tertiary: lastUsed asc.
  const scored = available.map((profileId) => {
    const type = store.profiles[profileId]?.type;
    const typeScore = type === "oauth" ? 0 : type === "token" ? 1 : type === "api_key" ? 2 : 3;
    const lastUsed = store.usageStats?.[profileId]?.lastUsed ?? 0;
    const priority = resolveProfilePriority(profileId, store, cfg);
    return { profileId, typeScore, lastUsed, priority };
  });

  // Primary: priority (desc). Secondary: type (oauth > token > api_key).
  // Tertiary: lastUsed (oldest first for round-robin within tier).
  const sorted = scored
    .toSorted((a, b) => {
      if (a.priority !== b.priority) {
        return b.priority - a.priority;
      }
      if (a.typeScore !== b.typeScore) {
        return a.typeScore - b.typeScore;
      }
      return a.lastUsed - b.lastUsed;
    })
    .map((entry) => entry.profileId);

  // Append cooldown profiles at the end (sorted by cooldown expiry, soonest first)
  const cooldownSorted = inCooldown
    .map((profileId) => ({
      profileId,
      cooldownUntil: resolveProfileUnusableUntil(store.usageStats?.[profileId] ?? {}) ?? now,
    }))
    .toSorted((a, b) => a.cooldownUntil - b.cooldownUntil)
    .map((entry) => entry.profileId);

  return [...sorted, ...cooldownSorted];
}

const PRIORITY_UNSET = Number.NEGATIVE_INFINITY;

/**
 * Resolve the effective priority for a profile. Secret-side
 * `credential.priority` wins; state-side `priorities.<id>` is the metadata
 * fallback; config-side `auth.profiles.<id>.priority` is the second fallback.
 * Unset (any side missing) yields `-Infinity` so the row sorts to the bottom
 * of its tier — round-robin then breaks the tie.
 */
function resolveProfilePriority(
  profileId: string,
  store: AuthProfileStore,
  cfg?: GenesisConfig,
): number {
  const secretPriority = store.profiles[profileId]?.priority;
  if (typeof secretPriority === "number" && Number.isFinite(secretPriority)) {
    return secretPriority;
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
