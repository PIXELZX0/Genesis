import { resolveControlUiAuthHeader } from "./control-ui-auth.ts";
import {
  loadChannels,
  logoutWhatsApp,
  startWhatsAppLogin,
  waitWhatsAppLogin,
  type ChannelsState,
} from "./controllers/channels.ts";
import { loadConfig, saveConfig, type ConfigState } from "./controllers/config.ts";
import type { NostrProfile } from "./types.ts";
import { createNostrProfileFormState } from "./views/channels.nostr-profile-form.ts";

type NostrProfileFormState = ReturnType<typeof createNostrProfileFormState> | null;

export type ChannelWizardStepOption = {
  value: unknown;
  label: string;
  hint?: string;
};

export type ChannelWizardStep = {
  id: string;
  type: "note" | "select" | "text" | "confirm" | "multiselect" | "progress" | "action";
  title?: string;
  message?: string;
  options?: ChannelWizardStepOption[];
  initialValue?: unknown;
  placeholder?: string;
  sensitive?: boolean;
  executor?: "gateway" | "client";
};

type ChannelWizardResult = {
  sessionId?: string;
  done: boolean;
  step?: ChannelWizardStep;
  status?: "running" | "done" | "cancelled" | "error";
  error?: string;
};

type ChannelsActionHost = ChannelsState &
  ConfigState & {
    hello?: { auth?: { deviceToken?: string | null } | null } | null;
    password?: string;
    settings: { token?: string };
    nostrProfileFormState: NostrProfileFormState;
    nostrProfileAccountId: string | null;
    channelWizardSessionId: string | null;
    channelWizardStep: ChannelWizardStep | null;
    channelWizardInput: unknown;
    channelWizardBusy: boolean;
    channelWizardError: string | null;
    channelWizardMessage: string | null;
  };

export async function handleWhatsAppStart(host: ChannelsActionHost, force: boolean) {
  await startWhatsAppLogin(host as ChannelsState, force);
  await loadChannels(host as ChannelsState, true);
}

export async function handleWhatsAppWait(host: ChannelsActionHost) {
  await waitWhatsAppLogin(host as ChannelsState);
  await loadChannels(host as ChannelsState, true);
}

export async function handleWhatsAppLogout(host: ChannelsActionHost) {
  await logoutWhatsApp(host as ChannelsState);
  await loadChannels(host as ChannelsState, true);
}

export async function handleChannelConfigSave(host: ChannelsActionHost) {
  await saveConfig(host as ConfigState);
  await loadConfig(host as ConfigState);
  await loadChannels(host as ChannelsState, true);
}

export async function handleChannelConfigReload(host: ChannelsActionHost) {
  await loadConfig(host as ConfigState);
  await loadChannels(host as ChannelsState, true);
}

function resolveInitialWizardInput(step: ChannelWizardStep): unknown {
  if (step.initialValue !== undefined) {
    return step.initialValue;
  }
  if (step.type === "select") {
    return step.options?.[0]?.value ?? "";
  }
  if (step.type === "multiselect") {
    return [];
  }
  if (step.type === "confirm") {
    return false;
  }
  if (step.type === "text") {
    return "";
  }
  return true;
}

async function applyChannelWizardResult(
  host: ChannelsActionHost,
  result: ChannelWizardResult,
  sessionId?: string | null,
) {
  if (result.step && !result.done) {
    host.channelWizardSessionId = result.sessionId ?? sessionId ?? host.channelWizardSessionId;
    host.channelWizardStep = result.step;
    host.channelWizardInput = resolveInitialWizardInput(result.step);
    host.channelWizardMessage = null;
    host.channelWizardError = null;
    return;
  }

  host.channelWizardSessionId = null;
  host.channelWizardStep = null;
  host.channelWizardInput = null;
  if (result.status === "error") {
    host.channelWizardError = result.error ?? "Channel setup failed.";
    host.channelWizardMessage = null;
    return;
  }
  if (result.status === "cancelled") {
    host.channelWizardError = null;
    host.channelWizardMessage = "Channel setup cancelled.";
    return;
  }
  host.channelWizardError = null;
  host.channelWizardMessage = null;
  await loadConfig(host as ConfigState);
  await loadChannels(host as ChannelsState, true);
}

export async function handleChannelWizardStart(host: ChannelsActionHost) {
  if (!host.client || !host.connected || host.channelWizardBusy) {
    return;
  }
  host.channelWizardBusy = true;
  host.channelWizardError = null;
  host.channelWizardMessage = null;
  try {
    const result = await host.client.request<ChannelWizardResult>("wizard.start", {
      target: "channels",
    });
    await applyChannelWizardResult(host, result, result.sessionId ?? null);
  } catch (err) {
    host.channelWizardError = String(err);
    host.channelWizardMessage = null;
  } finally {
    host.channelWizardBusy = false;
  }
}

export function handleChannelWizardInput(host: ChannelsActionHost, value: unknown) {
  host.channelWizardInput = value;
}

export async function handleChannelWizardSubmit(host: ChannelsActionHost) {
  if (!host.client || !host.connected || host.channelWizardBusy) {
    return;
  }
  const sessionId = host.channelWizardSessionId;
  const step = host.channelWizardStep;
  if (!sessionId || !step) {
    return;
  }
  host.channelWizardBusy = true;
  host.channelWizardError = null;
  try {
    const result = await host.client.request<ChannelWizardResult>("wizard.next", {
      sessionId,
      answer: {
        stepId: step.id,
        value: host.channelWizardInput,
      },
    });
    await applyChannelWizardResult(host, result, sessionId);
  } catch (err) {
    host.channelWizardError = String(err);
  } finally {
    host.channelWizardBusy = false;
  }
}

export async function handleChannelWizardCancel(host: ChannelsActionHost) {
  const sessionId = host.channelWizardSessionId;
  host.channelWizardSessionId = null;
  host.channelWizardStep = null;
  host.channelWizardInput = null;
  host.channelWizardError = null;
  host.channelWizardMessage = null;
  if (!sessionId || !host.client || !host.connected) {
    return;
  }
  try {
    await host.client.request("wizard.cancel", { sessionId });
  } catch {
    // The session may already have completed server-side.
  }
}

export function handleChannelWizardClose(host: ChannelsActionHost) {
  host.channelWizardError = null;
  host.channelWizardMessage = null;
}

function parseValidationErrors(details: unknown): Record<string, string> {
  if (!Array.isArray(details)) {
    return {};
  }
  const errors: Record<string, string> = {};
  for (const entry of details) {
    if (typeof entry !== "string") {
      continue;
    }
    const [rawField, ...rest] = entry.split(":");
    if (!rawField || rest.length === 0) {
      continue;
    }
    const field = rawField.trim();
    const message = rest.join(":").trim();
    if (field && message) {
      errors[field] = message;
    }
  }
  return errors;
}

function resolveNostrAccountId(host: ChannelsActionHost): string {
  const accounts = host.channelsSnapshot?.channelAccounts?.nostr ?? [];
  return accounts[0]?.accountId ?? host.nostrProfileAccountId ?? "default";
}

function buildNostrProfileUrl(accountId: string, suffix = ""): string {
  return `/api/channels/nostr/${encodeURIComponent(accountId)}/profile${suffix}`;
}

function buildGatewayHttpHeaders(host: ChannelsActionHost): Record<string, string> {
  const authorization = resolveControlUiAuthHeader(host);
  return authorization ? { Authorization: authorization } : {};
}

export function handleNostrProfileEdit(
  host: ChannelsActionHost,
  accountId: string,
  profile: NostrProfile | null,
) {
  host.nostrProfileAccountId = accountId;
  host.nostrProfileFormState = createNostrProfileFormState(profile ?? undefined);
}

export function handleNostrProfileCancel(host: ChannelsActionHost) {
  host.nostrProfileFormState = null;
  host.nostrProfileAccountId = null;
}

export function handleNostrProfileFieldChange(
  host: ChannelsActionHost,
  field: keyof NostrProfile,
  value: string,
) {
  const state = host.nostrProfileFormState;
  if (!state) {
    return;
  }
  host.nostrProfileFormState = {
    ...state,
    values: {
      ...state.values,
      [field]: value,
    },
    fieldErrors: {
      ...state.fieldErrors,
      [field]: "",
    },
  };
}

export function handleNostrProfileToggleAdvanced(host: ChannelsActionHost) {
  const state = host.nostrProfileFormState;
  if (!state) {
    return;
  }
  host.nostrProfileFormState = {
    ...state,
    showAdvanced: !state.showAdvanced,
  };
}

export async function handleNostrProfileSave(host: ChannelsActionHost) {
  const state = host.nostrProfileFormState;
  if (!state || state.saving) {
    return;
  }
  const accountId = resolveNostrAccountId(host);

  host.nostrProfileFormState = {
    ...state,
    saving: true,
    error: null,
    success: null,
    fieldErrors: {},
  };

  try {
    const response = await fetch(buildNostrProfileUrl(accountId), {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        ...buildGatewayHttpHeaders(host),
      },
      body: JSON.stringify(state.values),
    });
    const data = (await response.json().catch(() => null)) as {
      ok?: boolean;
      error?: string;
      details?: unknown;
      persisted?: boolean;
    } | null;

    if (!response.ok || data?.ok === false || !data) {
      const errorMessage = data?.error ?? `Profile update failed (${response.status})`;
      host.nostrProfileFormState = {
        ...state,
        saving: false,
        error: errorMessage,
        success: null,
        fieldErrors: parseValidationErrors(data?.details),
      };
      return;
    }

    if (!data.persisted) {
      host.nostrProfileFormState = {
        ...state,
        saving: false,
        error: "Profile publish failed on all relays.",
        success: null,
      };
      return;
    }

    host.nostrProfileFormState = {
      ...state,
      saving: false,
      error: null,
      success: "Profile published to relays.",
      fieldErrors: {},
      original: { ...state.values },
    };
    await loadChannels(host as ChannelsState, true);
  } catch (err) {
    host.nostrProfileFormState = {
      ...state,
      saving: false,
      error: `Profile update failed: ${String(err)}`,
      success: null,
    };
  }
}

export async function handleNostrProfileImport(host: ChannelsActionHost) {
  const state = host.nostrProfileFormState;
  if (!state || state.importing) {
    return;
  }
  const accountId = resolveNostrAccountId(host);

  host.nostrProfileFormState = {
    ...state,
    importing: true,
    error: null,
    success: null,
  };

  try {
    const response = await fetch(buildNostrProfileUrl(accountId, "/import"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...buildGatewayHttpHeaders(host),
      },
      body: JSON.stringify({ autoMerge: true }),
    });
    const data = (await response.json().catch(() => null)) as {
      ok?: boolean;
      error?: string;
      imported?: NostrProfile;
      merged?: NostrProfile;
      saved?: boolean;
    } | null;

    if (!response.ok || data?.ok === false || !data) {
      const errorMessage = data?.error ?? `Profile import failed (${response.status})`;
      host.nostrProfileFormState = {
        ...state,
        importing: false,
        error: errorMessage,
        success: null,
      };
      return;
    }

    const merged = data.merged ?? data.imported ?? null;
    const nextValues = merged ? { ...state.values, ...merged } : state.values;
    const showAdvanced = Boolean(
      nextValues.banner || nextValues.website || nextValues.nip05 || nextValues.lud16,
    );

    host.nostrProfileFormState = {
      ...state,
      importing: false,
      values: nextValues,
      error: null,
      success: data.saved
        ? "Profile imported from relays. Review and publish."
        : "Profile imported. Review and publish.",
      showAdvanced,
    };

    if (data.saved) {
      await loadChannels(host, true);
    }
  } catch (err) {
    host.nostrProfileFormState = {
      ...state,
      importing: false,
      error: `Profile import failed: ${String(err)}`,
      success: null,
    };
  }
}
