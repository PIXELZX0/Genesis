import { resolveDefaultAgentId } from "../../agents/agent-scope.js";
import {
  canonicalizeSpawnedByForAgent,
  resolveStoredSessionKeyForAgentStore,
} from "../../gateway/session-store-key.js";
import { normalizeAgentId } from "../../routing/session-key.js";
import { getFileStatSnapshot } from "../cache-utils.js";
import type { GenesisConfig } from "../types.genesis.js";
import { resolveStorePath } from "./paths.js";
import { isSessionStoreCacheEnabled } from "./store-cache.js";
import { loadSessionStore } from "./store-load.js";
import { resolveAllAgentSessionStoreTargetsSync } from "./targets.js";
import type { SessionEntry } from "./types.js";

// sessions.list is polled by every connected Control UI, and each call otherwise
// reloads, deep-clones, and re-merges every agent's session store. The merged
// result is memoized against the stat of each contributing store file.
type CombinedStoreCacheEntry = {
  signature: string;
  storePath: string;
  store: Record<string, SessionEntry>;
};

let combinedStoreCache: CombinedStoreCacheEntry | null = null;

function buildCombinedStoreSignature(params: {
  cfg: GenesisConfig;
  storePaths: string[];
  defaultAgentId: string;
}): string {
  const parts = params.storePaths.map((storePath) => {
    const stat = getFileStatSnapshot(storePath);
    return `${storePath}:${stat?.mtimeMs ?? "-"}:${stat?.sizeBytes ?? "-"}`;
  });
  return `${params.defaultAgentId}|${parts.join("|")}`;
}

function readCombinedStoreCache(
  signature: string,
): { storePath: string; store: Record<string, SessionEntry> } | null {
  if (!isSessionStoreCacheEnabled() || combinedStoreCache?.signature !== signature) {
    return null;
  }
  return {
    storePath: combinedStoreCache.storePath,
    store: structuredClone(combinedStoreCache.store),
  };
}

function writeCombinedStoreCache(entry: CombinedStoreCacheEntry): void {
  combinedStoreCache = isSessionStoreCacheEnabled()
    ? { ...entry, store: structuredClone(entry.store) }
    : null;
}

export function clearCombinedSessionStoreCacheForTest(): void {
  combinedStoreCache = null;
}

function isStorePathTemplate(store?: string): boolean {
  return typeof store === "string" && store.includes("{agentId}");
}

function mergeSessionEntryIntoCombined(params: {
  cfg: GenesisConfig;
  combined: Record<string, SessionEntry>;
  entry: SessionEntry;
  agentId: string;
  canonicalKey: string;
}) {
  const { cfg, combined, entry, agentId, canonicalKey } = params;
  const existing = combined[canonicalKey];

  if (existing && (existing.updatedAt ?? 0) > (entry.updatedAt ?? 0)) {
    combined[canonicalKey] = {
      ...entry,
      ...existing,
      spawnedBy: canonicalizeSpawnedByForAgent(cfg, agentId, existing.spawnedBy ?? entry.spawnedBy),
    };
  } else {
    combined[canonicalKey] = {
      ...existing,
      ...entry,
      spawnedBy: canonicalizeSpawnedByForAgent(
        cfg,
        agentId,
        entry.spawnedBy ?? existing?.spawnedBy,
      ),
    };
  }
}

export function loadCombinedSessionStoreForGateway(cfg: GenesisConfig): {
  storePath: string;
  store: Record<string, SessionEntry>;
} {
  const storeConfig = cfg.session?.store;
  if (storeConfig && !isStorePathTemplate(storeConfig)) {
    const storePath = resolveStorePath(storeConfig);
    const defaultAgentId = normalizeAgentId(resolveDefaultAgentId(cfg));
    const signature = buildCombinedStoreSignature({
      cfg,
      storePaths: [storePath],
      defaultAgentId,
    });
    const cachedSingle = readCombinedStoreCache(signature);
    if (cachedSingle) {
      return cachedSingle;
    }
    const store = loadSessionStore(storePath);
    const combined: Record<string, SessionEntry> = {};
    for (const [key, entry] of Object.entries(store)) {
      const canonicalKey = resolveStoredSessionKeyForAgentStore({
        cfg,
        agentId: defaultAgentId,
        sessionKey: key,
      });
      mergeSessionEntryIntoCombined({
        cfg,
        combined,
        entry,
        agentId: defaultAgentId,
        canonicalKey,
      });
    }
    writeCombinedStoreCache({ signature, storePath, store: combined });
    return { storePath, store: combined };
  }

  const targets = resolveAllAgentSessionStoreTargetsSync(cfg);
  const signature = buildCombinedStoreSignature({
    cfg,
    storePaths: targets.map((target) => target.storePath),
    defaultAgentId: normalizeAgentId(resolveDefaultAgentId(cfg)),
  });
  const cachedCombined = readCombinedStoreCache(signature);
  if (cachedCombined) {
    return cachedCombined;
  }
  const combined: Record<string, SessionEntry> = {};
  for (const target of targets) {
    const agentId = target.agentId;
    const storePath = target.storePath;
    const store = loadSessionStore(storePath);
    for (const [key, entry] of Object.entries(store)) {
      const canonicalKey = resolveStoredSessionKeyForAgentStore({
        cfg,
        agentId,
        sessionKey: key,
      });
      mergeSessionEntryIntoCombined({
        cfg,
        combined,
        entry,
        agentId,
        canonicalKey,
      });
    }
  }

  const storePath =
    typeof storeConfig === "string" && storeConfig.trim() ? storeConfig.trim() : "(multiple)";
  writeCombinedStoreCache({ signature, storePath, store: combined });
  return { storePath, store: combined };
}
