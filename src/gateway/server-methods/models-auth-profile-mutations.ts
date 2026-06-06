import { resolveGenesisAgentDir } from "../../agents/agent-paths.js";
import {
  removeAuthProfileWithLock,
  setAuthProfileOrder,
  updateAuthProfileMetadataWithLock,
  upsertAuthProfileWithLock,
} from "../../agents/auth-profiles/profiles.js";
import type { AuthProfileCredential } from "../../agents/auth-profiles/types.js";
import { resolveProviderIdForAuth } from "../../agents/provider-auth-aliases.js";
import { loadConfig, type GenesisConfig } from "../../config/config.js";
import { isSecretRef, type SecretRef } from "../../config/types.secrets.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import { formatForLog } from "../ws-log.js";
import { invalidateModelAuthStatusCache } from "./models-auth-status.js";
import type { GatewayRequestHandlers } from "./types.js";

const MAX_DISPLAY_NAME_LENGTH = 80;

type AddParams = {
  profileId?: unknown;
  provider?: unknown;
  mode?: unknown;
  value?: unknown;
  valueRef?: unknown;
  displayName?: unknown;
  priority?: unknown;
};

type RemoveParams = {
  profileId?: unknown;
};

type RenameParams = {
  profileId?: unknown;
  displayName?: unknown;
};

type SetPriorityParams = {
  profileId?: unknown;
  priority?: unknown;
};

type ReorderParams = {
  provider?: unknown;
  profileIds?: unknown;
};

function fail(respond: Parameters<GatewayRequestHandlers[string]>[0]["respond"], message: string) {
  respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, message));
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readDisplayName(value: unknown): string | undefined {
  const trimmed = readString(value);
  if (trimmed === undefined) {
    return undefined;
  }
  if (trimmed.length > MAX_DISPLAY_NAME_LENGTH) {
    throw new Error(
      `displayName exceeds ${MAX_DISPLAY_NAME_LENGTH} characters (got ${trimmed.length}).`,
    );
  }
  return trimmed;
}

function readPriority(value: unknown): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || !Number.isFinite(value)) {
    throw new Error(`priority must be an integer (got ${JSON.stringify(value)})`);
  }
  return value;
}

function readMode(value: unknown): "api_key" | "oauth" | "token" | undefined {
  if (value === "api_key" || value === "oauth" || value === "token") {
    return value;
  }
  return undefined;
}

function readSecretRef(value: unknown): SecretRef | undefined {
  if (!isSecretRef(value)) {
    return undefined;
  }
  return value;
}

function buildCredential(params: {
  provider: string;
  mode: "api_key" | "oauth" | "token";
  value: string | undefined;
  valueRef: SecretRef | undefined;
  displayName?: string;
  priority?: number;
}): AuthProfileCredential {
  const base = {
    provider: params.provider,
    ...(params.displayName !== undefined ? { displayName: params.displayName } : {}),
    ...(params.priority !== undefined ? { priority: params.priority } : {}),
  };
  if (params.mode === "api_key") {
    if (params.valueRef) {
      return { type: "api_key", ...base, keyRef: params.valueRef };
    }
    return { type: "api_key", ...base, ...(params.value ? { key: params.value } : {}) };
  }
  if (params.mode === "token") {
    if (params.valueRef) {
      return { type: "token", ...base, tokenRef: params.valueRef };
    }
    return { type: "token", ...base, ...(params.value ? { token: params.value } : {}) };
  }
  // oauth: require a value. The dashboard typically funnels oauth via the
  // existing models.authStatus login flow; this RPC accepts the encoded
  // access/refresh/expires triple as a JSON object on the `value` field.
  if (!params.value) {
    throw new Error("oauth credentials require a value payload (access/refresh/expires).");
  }
  let parsed: { access?: string; refresh?: string; expires?: number };
  try {
    parsed = JSON.parse(params.value) as { access?: string; refresh?: string; expires?: number };
  } catch {
    throw new Error("oauth value must be a JSON object { access, refresh, expires }.");
  }
  if (
    typeof parsed.access !== "string" ||
    typeof parsed.refresh !== "string" ||
    typeof parsed.expires !== "number"
  ) {
    throw new Error("oauth value must be { access: string, refresh: string, expires: number }.");
  }
  return {
    type: "oauth",
    ...base,
    access: parsed.access,
    refresh: parsed.refresh,
    expires: parsed.expires,
  };
}

export const modelsAuthProfileMutationHandlers: GatewayRequestHandlers = {
  "models.authProfileAdd": async ({ params, respond }) => {
    const p = (params ?? {}) as AddParams;
    const profileId = readString(p.profileId);
    const provider = readString(p.provider);
    const mode = readMode(p.mode);
    if (!profileId) {
      fail(respond, "profileId is required.");
      return;
    }
    if (!provider) {
      fail(respond, "provider is required.");
      return;
    }
    if (!mode) {
      fail(respond, 'mode must be one of "api_key", "oauth", "token".');
      return;
    }
    let displayName: string | undefined;
    let priority: number | undefined;
    try {
      displayName = readDisplayName(p.displayName);
      priority = readPriority(p.priority);
    } catch (err) {
      fail(respond, formatForLog(err));
      return;
    }
    const valueRef = readSecretRef(p.valueRef);
    const value = typeof p.value === "string" ? p.value : undefined;

    let credential: AuthProfileCredential;
    try {
      credential = buildCredential({ provider, mode, value, valueRef, displayName, priority });
    } catch (err) {
      fail(respond, formatForLog(err));
      return;
    }

    const agentDir = resolveGenesisAgentDir();
    const updated = await upsertAuthProfileWithLock({ profileId, credential, agentDir });
    if (!updated) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, "Failed to update auth-profiles.json (lock busy?)."),
      );
      return;
    }
    invalidateModelAuthStatusCache();
    respond(true, { profileId, provider: updated.profiles[profileId]?.provider }, undefined);
  },

  "models.authProfileRemove": async ({ params, respond }) => {
    const p = (params ?? {}) as RemoveParams;
    const profileId = readString(p.profileId);
    if (!profileId) {
      fail(respond, "profileId is required.");
      return;
    }
    const agentDir = resolveGenesisAgentDir();
    const updated = await removeAuthProfileWithLock({ profileId, agentDir });
    if (!updated) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, "Failed to update auth-profiles.json (lock busy?)."),
      );
      return;
    }
    invalidateModelAuthStatusCache();
    respond(true, { profileId, removed: !updated.profiles[profileId] }, undefined);
  },

  "models.authProfileRename": async ({ params, respond }) => {
    const p = (params ?? {}) as RenameParams;
    const profileId = readString(p.profileId);
    if (!profileId) {
      fail(respond, "profileId is required.");
      return;
    }
    let displayName: string | undefined;
    try {
      displayName = readDisplayName(p.displayName);
    } catch (err) {
      fail(respond, formatForLog(err));
      return;
    }
    if (displayName === undefined) {
      fail(respond, "displayName is required.");
      return;
    }

    const agentDir = resolveGenesisAgentDir();
    const updated = await updateAuthProfileMetadataWithLock({
      profileId,
      displayName,
      agentDir,
    });
    if (!updated) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `Auth profile "${profileId}" not found.`),
      );
      return;
    }
    invalidateModelAuthStatusCache();
    respond(true, { profileId, displayName }, undefined);
  },

  "models.authProfileSetPriority": async ({ params, respond }) => {
    const p = (params ?? {}) as SetPriorityParams;
    const profileId = readString(p.profileId);
    if (!profileId) {
      fail(respond, "profileId is required.");
      return;
    }
    let priority: number | null;
    try {
      if (p.priority === null) {
        priority = null;
      } else {
        const parsed = readPriority(p.priority);
        if (parsed === undefined) {
          fail(respond, "priority is required (integer; pass null to clear).");
          return;
        }
        priority = parsed;
      }
    } catch (err) {
      fail(respond, formatForLog(err));
      return;
    }

    const agentDir = resolveGenesisAgentDir();
    const updated = await updateAuthProfileMetadataWithLock({
      profileId,
      priority,
      agentDir,
    });
    if (!updated) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `Auth profile "${profileId}" not found.`),
      );
      return;
    }
    invalidateModelAuthStatusCache();
    respond(true, { profileId, priority }, undefined);
  },

  "models.authProfileReorder": async ({ params, respond }) => {
    const p = (params ?? {}) as ReorderParams;
    const provider = readString(p.provider);
    if (!provider) {
      fail(respond, "provider is required.");
      return;
    }
    if (!Array.isArray(p.profileIds) || p.profileIds.some((id) => typeof id !== "string")) {
      fail(respond, "profileIds must be an array of strings.");
      return;
    }
    const profileIds = p.profileIds.filter(
      (id): id is string => typeof id === "string" && id.trim().length > 0,
    );
    const cfg: GenesisConfig | null = (() => {
      try {
        return loadConfig();
      } catch {
        return null;
      }
    })();
    const providerKey = resolveProviderIdForAuth(provider, { config: cfg ?? undefined });

    const agentDir = resolveGenesisAgentDir();
    const updated = await setAuthProfileOrder({
      agentDir,
      provider: providerKey,
      order: profileIds,
    });
    if (!updated) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, "Failed to update auth-state.json (lock busy?)."),
      );
      return;
    }
    invalidateModelAuthStatusCache();
    respond(
      true,
      { provider: providerKey, profileIds: updated.order?.[providerKey] ?? [] },
      undefined,
    );
  },
};
