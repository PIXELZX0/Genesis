import type { GatewayBrowserClient } from "../gateway.ts";
import type { PluginStatusReport } from "../types.ts";

export type PluginClawHubPackage = {
  name: string;
  displayName: string;
  family: "code-plugin" | "bundle-plugin";
  runtimeId?: string | null;
  channel: "official" | "community" | "private";
  isOfficial: boolean;
  summary?: string | null;
  ownerHandle?: string | null;
  createdAt: number;
  updatedAt: number;
  latestVersion?: string | null;
  capabilityTags?: string[];
  executesCode?: boolean;
  verificationTier?: string | null;
  tags?: Record<string, string>;
  compatibility?: {
    pluginApiRange?: string;
    builtWithGenesisVersion?: string;
    pluginSdkVersion?: string;
    minGatewayVersion?: string;
  } | null;
  capabilities?: {
    executesCode?: boolean;
    runtimeId?: string;
    capabilityTags?: string[];
    bundleFormat?: string;
    hostTargets?: string[];
    pluginKind?: string;
    channels?: string[];
    providers?: string[];
    hooks?: string[];
    bundledSkills?: string[];
  } | null;
  verification?: {
    tier?: string;
    scope?: string;
    summary?: string;
    sourceRepo?: string;
    sourceCommit?: string;
    hasProvenance?: boolean;
    scanStatus?: string;
  } | null;
};

export type PluginClawHubSearchResult = {
  score: number;
  package: PluginClawHubPackage;
};

export type PluginClawHubDetail = {
  package: PluginClawHubPackage | null;
  owner?: {
    handle?: string | null;
    displayName?: string | null;
    image?: string | null;
  } | null;
};

export type PluginMessage = {
  kind: "success" | "error";
  message: string;
};

export type PluginMessageMap = Record<string, PluginMessage>;

export type PluginsState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  pluginsLoading: boolean;
  pluginsReport: PluginStatusReport | null;
  pluginsError: string | null;
  pluginsFilter: string;
  pluginsStatusFilter: "all" | "loaded" | "disabled" | "error" | "managed";
  pluginsBusyKey: string | null;
  pluginMessages: PluginMessageMap;
  pluginDetailKey: string | null;
  pluginClawhubSearchQuery: string;
  pluginClawhubSearchResults: PluginClawHubSearchResult[] | null;
  pluginClawhubSearchLoading: boolean;
  pluginClawhubSearchError: string | null;
  pluginClawhubDetail: PluginClawHubDetail | null;
  pluginClawhubDetailName: string | null;
  pluginClawhubDetailLoading: boolean;
  pluginClawhubDetailError: string | null;
  pluginClawhubInstallName: string | null;
  pluginClawhubInstallMessage: { kind: "success" | "error"; text: string } | null;
};

const getErrorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

function setPluginMessage(state: PluginsState, key: string, message: PluginMessage) {
  if (!key.trim()) {
    return;
  }
  state.pluginMessages = { ...state.pluginMessages, [key]: message };
}

async function runStaleAwareRequest<T>(
  isCurrent: () => boolean,
  request: () => Promise<T>,
  onSuccess: (value: T) => void,
  onError: (err: unknown) => void,
  onFinally: () => void,
) {
  try {
    const result = await request();
    if (!isCurrent()) {
      return;
    }
    onSuccess(result);
  } catch (err) {
    if (!isCurrent()) {
      return;
    }
    onError(err);
  }
  onFinally();
}

export async function loadPlugins(state: PluginsState, options?: { clearMessages?: boolean }) {
  if (options?.clearMessages && Object.keys(state.pluginMessages).length > 0) {
    state.pluginMessages = {};
  }
  if (!state.client || !state.connected || state.pluginsLoading) {
    return;
  }
  state.pluginsLoading = true;
  state.pluginsError = null;
  try {
    const res = await state.client.request<PluginStatusReport | undefined>("plugins.status", {});
    if (res) {
      state.pluginsReport = res;
    }
  } catch (err) {
    state.pluginsError = getErrorMessage(err);
  } finally {
    state.pluginsLoading = false;
  }
}

async function runPluginMutation(
  state: PluginsState,
  pluginId: string,
  run: (client: GatewayBrowserClient) => Promise<PluginMessage>,
) {
  const client = state.client;
  if (!client || !state.connected) {
    return;
  }
  state.pluginsBusyKey = pluginId;
  state.pluginsError = null;
  try {
    const message = await run(client);
    await loadPlugins(state);
    setPluginMessage(state, pluginId, message);
  } catch (err) {
    const message = getErrorMessage(err);
    state.pluginsError = message;
    setPluginMessage(state, pluginId, {
      kind: "error",
      message,
    });
  } finally {
    state.pluginsBusyKey = null;
  }
}

export async function updatePluginEnabled(state: PluginsState, pluginId: string, enabled: boolean) {
  await runPluginMutation(state, pluginId, async (client) => {
    const result = await client.request<{ message?: string }>("plugins.update", {
      pluginId,
      enabled,
    });
    return {
      kind: "success",
      message: result?.message ?? (enabled ? "Plugin enabled" : "Plugin disabled"),
    };
  });
}

export async function uninstallPlugin(state: PluginsState, pluginId: string) {
  await runPluginMutation(state, pluginId, async (client) => {
    const result = await client.request<{ message?: string }>("plugins.uninstall", {
      pluginId,
    });
    return {
      kind: "success",
      message: result?.message ?? "Plugin uninstalled",
    };
  });
}

export function setPluginClawHubSearchQuery(state: PluginsState, query: string) {
  state.pluginClawhubSearchQuery = query;
  state.pluginClawhubInstallMessage = null;
  state.pluginClawhubSearchResults = null;
  state.pluginClawhubSearchError = null;
  state.pluginClawhubSearchLoading = false;
}

export async function searchPluginClawHub(state: PluginsState, query: string) {
  if (!state.client || !state.connected) {
    return;
  }
  if (!query.trim()) {
    state.pluginClawhubSearchResults = null;
    state.pluginClawhubSearchError = null;
    state.pluginClawhubSearchLoading = false;
    return;
  }
  const client = state.client;
  state.pluginClawhubSearchResults = null;
  state.pluginClawhubSearchLoading = true;
  state.pluginClawhubSearchError = null;
  await runStaleAwareRequest(
    () => query === state.pluginClawhubSearchQuery,
    () =>
      client.request<{ results: PluginClawHubSearchResult[] }>("plugins.search", {
        query,
        limit: 24,
      }),
    (res) => {
      state.pluginClawhubSearchResults = res?.results ?? [];
    },
    (err) => {
      state.pluginClawhubSearchError = getErrorMessage(err);
    },
    () => {
      state.pluginClawhubSearchLoading = false;
    },
  );
}

export async function loadPluginClawHubDetail(state: PluginsState, name: string) {
  if (!state.client || !state.connected) {
    return;
  }
  const client = state.client;
  state.pluginClawhubDetailName = name;
  state.pluginClawhubDetailLoading = true;
  state.pluginClawhubDetailError = null;
  state.pluginClawhubDetail = null;
  await runStaleAwareRequest(
    () => name === state.pluginClawhubDetailName,
    () => client.request<PluginClawHubDetail>("plugins.detail", { name }),
    (res) => {
      state.pluginClawhubDetail = res ?? null;
    },
    (err) => {
      state.pluginClawhubDetailError = getErrorMessage(err);
    },
    () => {
      state.pluginClawhubDetailLoading = false;
    },
  );
}

export function closePluginClawHubDetail(state: PluginsState) {
  state.pluginClawhubDetailName = null;
  state.pluginClawhubDetail = null;
  state.pluginClawhubDetailLoading = false;
  state.pluginClawhubDetailError = null;
}

export async function installPluginFromClawHub(state: PluginsState, name: string) {
  if (!state.client || !state.connected) {
    return;
  }
  state.pluginClawhubInstallName = name;
  state.pluginClawhubInstallMessage = null;
  try {
    const result = await state.client.request<{ message?: string }>("plugins.install", {
      source: "clawhub",
      name,
    });
    state.pluginClawhubInstallMessage = {
      kind: "success",
      text: result?.message ?? `Installed ${name}`,
    };
    await loadPlugins(state);
  } catch (err) {
    state.pluginClawhubInstallMessage = {
      kind: "error",
      text: getErrorMessage(err),
    };
  } finally {
    state.pluginClawhubInstallName = null;
  }
}
