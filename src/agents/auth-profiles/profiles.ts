import { normalizeStringEntries } from "../../shared/string-normalization.js";
import { normalizeSecretInput } from "../../utils/normalize-secret-input.js";
import { resolveProviderIdForAuth } from "../provider-auth-aliases.js";
import { normalizeProviderId } from "../provider-id.js";
import { dedupeProfileIds, listProfilesForProvider } from "./profile-list.js";
import {
  ensureAuthProfileStoreForLocalUpdate,
  saveAuthProfileStore,
  updateAuthProfileStoreWithLock,
} from "./store.js";
import type { AuthProfileCredential, AuthProfileStore } from "./types.js";
export { dedupeProfileIds, listProfilesForProvider } from "./profile-list.js";

export async function setAuthProfileOrder(params: {
  agentDir?: string;
  provider: string;
  order?: string[] | null;
}): Promise<AuthProfileStore | null> {
  const providerKey = normalizeProviderId(params.provider);
  const sanitized =
    params.order && Array.isArray(params.order) ? normalizeStringEntries(params.order) : [];
  const deduped = dedupeProfileIds(sanitized);

  return await updateAuthProfileStoreWithLock({
    agentDir: params.agentDir,
    updater: (store) => {
      store.order = store.order ?? {};
      if (deduped.length === 0) {
        if (!store.order[providerKey]) {
          return false;
        }
        delete store.order[providerKey];
        if (Object.keys(store.order).length === 0) {
          store.order = undefined;
        }
        return true;
      }
      store.order[providerKey] = deduped;
      return true;
    },
  });
}

export function upsertAuthProfile(params: {
  profileId: string;
  credential: AuthProfileCredential;
  agentDir?: string;
}): void {
  const credential =
    params.credential.type === "api_key"
      ? {
          ...params.credential,
          ...(typeof params.credential.key === "string"
            ? { key: normalizeSecretInput(params.credential.key) }
            : {}),
        }
      : params.credential.type === "token"
        ? { ...params.credential, token: normalizeSecretInput(params.credential.token) }
        : params.credential;
  const store = ensureAuthProfileStoreForLocalUpdate(params.agentDir);
  store.profiles[params.profileId] = credential;
  saveAuthProfileStore(store, params.agentDir, {
    filterExternalAuthProfiles: false,
    syncExternalCli: false,
  });
}

export async function upsertAuthProfileWithLock(params: {
  profileId: string;
  credential: AuthProfileCredential;
  agentDir?: string;
}): Promise<AuthProfileStore | null> {
  return await updateAuthProfileStoreWithLock({
    agentDir: params.agentDir,
    updater: (store) => {
      store.profiles[params.profileId] = params.credential;
      return true;
    },
  });
}

export async function removeProviderAuthProfilesWithLock(params: {
  provider: string;
  agentDir?: string;
}): Promise<AuthProfileStore | null> {
  const providerKey = resolveProviderIdForAuth(params.provider);
  const storeOrderKey = normalizeProviderId(params.provider);
  return await updateAuthProfileStoreWithLock({
    agentDir: params.agentDir,
    updater: (store) => {
      const profileIds = listProfilesForProvider(store, params.provider);
      let changed = false;
      for (const profileId of profileIds) {
        if (store.profiles[profileId]) {
          delete store.profiles[profileId];
          changed = true;
        }
        if (store.usageStats?.[profileId]) {
          delete store.usageStats[profileId];
          changed = true;
        }
      }
      if (store.order?.[storeOrderKey]) {
        delete store.order[storeOrderKey];
        changed = true;
        if (Object.keys(store.order).length === 0) {
          store.order = undefined;
        }
      }
      if (store.lastGood?.[providerKey]) {
        delete store.lastGood[providerKey];
        changed = true;
        if (Object.keys(store.lastGood).length === 0) {
          store.lastGood = undefined;
        }
      }
      if (store.usageStats && Object.keys(store.usageStats).length === 0) {
        store.usageStats = undefined;
      }
      return changed;
    },
  });
}

/**
 * Remove a single profile by id — drops the credential, its usage stats, and
 * any priority override. Does not touch other profiles for the same provider
 * (use {@link removeProviderAuthProfilesWithLock} for that). Returns the
 * post-update store or `null` if the lock failed.
 */
export async function removeAuthProfileWithLock(params: {
  profileId: string;
  agentDir?: string;
}): Promise<AuthProfileStore | null> {
  return await updateAuthProfileStoreWithLock({
    agentDir: params.agentDir,
    updater: (store) => {
      let changed = false;
      if (store.profiles[params.profileId]) {
        delete store.profiles[params.profileId];
        changed = true;
      }
      if (store.usageStats?.[params.profileId]) {
        delete store.usageStats[params.profileId];
        changed = true;
      }
      if (store.priorities?.[params.profileId] !== undefined) {
        delete store.priorities[params.profileId];
        changed = true;
        if (Object.keys(store.priorities).length === 0) {
          store.priorities = undefined;
        }
      }
      if (store.usageStats && Object.keys(store.usageStats).length === 0) {
        store.usageStats = undefined;
      }
      return changed;
    },
  });
}

/**
 * Update the secret-side credential fields in place. Used by the rename and
 * set-priority flows. The credential type and provider are immutable; this
 * only mutates mutable metadata (displayName, priority) and the api_key
 * `metadata` map. Returns the post-update store or `null` if the lock failed
 * or the profile does not exist.
 */
export async function updateAuthProfileMetadataWithLock(params: {
  profileId: string;
  displayName?: string | null;
  priority?: number | null;
  agentDir?: string;
}): Promise<AuthProfileStore | null> {
  return await updateAuthProfileStoreWithLock({
    agentDir: params.agentDir,
    updater: (store) => {
      const credential = store.profiles[params.profileId];
      if (!credential) {
        return false;
      }
      let changed = false;
      if (params.displayName !== undefined) {
        const next =
          params.displayName === null || params.displayName.length === 0
            ? undefined
            : params.displayName;
        if (next !== credential.displayName) {
          credential.displayName = next;
          changed = true;
        }
      }
      if (params.priority !== undefined) {
        const next = params.priority === null ? undefined : params.priority;
        if (next !== credential.priority) {
          credential.priority = next;
          changed = true;
        }
      }
      return changed;
    },
  });
}

export async function markAuthProfileGood(params: {
  store: AuthProfileStore;
  provider: string;
  profileId: string;
  agentDir?: string;
}): Promise<void> {
  const { store, provider, profileId, agentDir } = params;
  const providerKey = resolveProviderIdForAuth(provider);
  const updated = await updateAuthProfileStoreWithLock({
    agentDir,
    updater: (freshStore) => {
      const profile = freshStore.profiles[profileId];
      if (!profile || resolveProviderIdForAuth(profile.provider) !== providerKey) {
        return false;
      }
      freshStore.lastGood = { ...freshStore.lastGood, [providerKey]: profileId };
      return true;
    },
  });
  if (updated) {
    store.lastGood = updated.lastGood;
    return;
  }
  const profile = store.profiles[profileId];
  if (!profile || resolveProviderIdForAuth(profile.provider) !== providerKey) {
    return;
  }
  store.lastGood = { ...store.lastGood, [providerKey]: profileId };
  saveAuthProfileStore(store, agentDir);
}
