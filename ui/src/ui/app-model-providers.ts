import type { ChannelWizardStep } from "./app-channels.ts";
import { loadConfig, type ConfigState } from "./controllers/config.ts";
import {
  loadModelAuthStatusState,
  type ModelAuthStatusState,
} from "./controllers/model-auth-status.ts";
import { loadModels } from "./controllers/models.ts";
import type { ModelCatalogEntry } from "./types.ts";

export type ModelProviderWizardStep = ChannelWizardStep;

type ModelProviderWizardResult = {
  sessionId?: string;
  done: boolean;
  step?: ModelProviderWizardStep;
  status?: "running" | "done" | "cancelled" | "error";
  error?: string;
};

type ModelProviderWizardHost = ConfigState &
  ModelAuthStatusState & {
    chatModelCatalog: ModelCatalogEntry[];
    modelProviderWizardSessionId: string | null;
    modelProviderWizardStep: ModelProviderWizardStep | null;
    modelProviderWizardInput: unknown;
    modelProviderWizardBusy: boolean;
    modelProviderWizardError: string | null;
    modelProviderWizardMessage: string | null;
  };

function resolveInitialWizardInput(step: ModelProviderWizardStep): unknown {
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
    return Boolean(step.initialValue);
  }
  if (step.type === "text") {
    return "";
  }
  return true;
}

async function refreshModelProviderSurfaces(host: ModelProviderWizardHost) {
  await loadConfig(host);
  if (host.client && host.connected) {
    host.chatModelCatalog = await loadModels(host.client);
  }
  await loadModelAuthStatusState(host, { refresh: true });
}

async function applyModelProviderWizardResult(
  host: ModelProviderWizardHost,
  result: ModelProviderWizardResult,
  sessionId?: string | null,
) {
  if (result.step && !result.done) {
    host.modelProviderWizardSessionId =
      result.sessionId ?? sessionId ?? host.modelProviderWizardSessionId;
    host.modelProviderWizardStep = result.step;
    host.modelProviderWizardInput = resolveInitialWizardInput(result.step);
    host.modelProviderWizardMessage = null;
    host.modelProviderWizardError = null;
    return;
  }

  host.modelProviderWizardSessionId = null;
  host.modelProviderWizardStep = null;
  host.modelProviderWizardInput = null;
  if (result.status === "error") {
    host.modelProviderWizardError = result.error ?? "Model provider setup failed.";
    host.modelProviderWizardMessage = null;
    return;
  }
  if (result.status === "cancelled") {
    host.modelProviderWizardError = null;
    host.modelProviderWizardMessage = "Model provider setup cancelled.";
    return;
  }
  host.modelProviderWizardError = null;
  host.modelProviderWizardMessage = "Model provider connected.";
  await refreshModelProviderSurfaces(host);
}

export async function handleModelProviderWizardStart(host: ModelProviderWizardHost) {
  if (!host.client || !host.connected || host.modelProviderWizardBusy) {
    return;
  }
  host.modelProviderWizardBusy = true;
  host.modelProviderWizardError = null;
  host.modelProviderWizardMessage = null;
  try {
    const result = await host.client.request<ModelProviderWizardResult>("wizard.start", {
      target: "models",
    });
    await applyModelProviderWizardResult(host, result, result.sessionId ?? null);
  } catch (err) {
    host.modelProviderWizardError = String(err);
    host.modelProviderWizardMessage = null;
  } finally {
    host.modelProviderWizardBusy = false;
  }
}

export function handleModelProviderWizardInput(host: ModelProviderWizardHost, value: unknown) {
  host.modelProviderWizardInput = value;
}

export async function handleModelProviderWizardSubmit(host: ModelProviderWizardHost) {
  if (!host.client || !host.connected || host.modelProviderWizardBusy) {
    return;
  }
  const sessionId = host.modelProviderWizardSessionId;
  const step = host.modelProviderWizardStep;
  if (!sessionId || !step) {
    return;
  }
  host.modelProviderWizardBusy = true;
  host.modelProviderWizardError = null;
  try {
    const result = await host.client.request<ModelProviderWizardResult>("wizard.next", {
      sessionId,
      answer: {
        stepId: step.id,
        value: host.modelProviderWizardInput,
      },
    });
    await applyModelProviderWizardResult(host, result, sessionId);
  } catch (err) {
    host.modelProviderWizardError = String(err);
  } finally {
    host.modelProviderWizardBusy = false;
  }
}

export async function handleModelProviderWizardCancel(host: ModelProviderWizardHost) {
  const sessionId = host.modelProviderWizardSessionId;
  host.modelProviderWizardSessionId = null;
  host.modelProviderWizardStep = null;
  host.modelProviderWizardInput = null;
  host.modelProviderWizardError = null;
  host.modelProviderWizardMessage = null;
  if (!sessionId || !host.client || !host.connected) {
    return;
  }
  try {
    await host.client.request("wizard.cancel", { sessionId });
  } catch {
    // The session may already have completed server-side.
  }
}

export function handleModelProviderWizardClose(host: ModelProviderWizardHost) {
  host.modelProviderWizardError = null;
  host.modelProviderWizardMessage = null;
}
