import type { GatewayBrowserClient } from "../gateway.ts";
import type { HealthSnapshot, StatusSummary } from "../types.ts";
import { loadModels } from "./models.ts";

export type DebugState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  debugLoading: boolean;
  debugStatus: StatusSummary | null;
  debugHealth: HealthSnapshot | null;
  debugModels: unknown[];
  debugCallMethod: string;
  debugCallParams: string;
  debugCallResult: string | null;
  debugCallError: string | null;
};

export async function loadDebug(state: DebugState) {
  if (!state.client || !state.connected) {
    return;
  }
  if (state.debugLoading) {
    return;
  }
  state.debugLoading = true;
  const client = state.client;
  try {
    const [status, health, models] = await Promise.all([
      client.request("status", {}),
      client.request("health", {}),
      loadModels(client),
    ]);
    if (state.client !== client || !state.connected) {
      return;
    }
    state.debugStatus = status as StatusSummary;
    state.debugHealth = health as HealthSnapshot;
    state.debugModels = models;
  } catch (err) {
    if (state.client !== client || !state.connected) {
      return;
    }
    state.debugCallError = String(err);
  } finally {
    state.debugLoading = false;
  }
}

export async function callDebugMethod(state: DebugState) {
  if (!state.client || !state.connected) {
    return;
  }
  state.debugCallError = null;
  state.debugCallResult = null;
  try {
    const params = state.debugCallParams.trim()
      ? (JSON.parse(state.debugCallParams) as unknown)
      : {};
    const res = await state.client.request(state.debugCallMethod.trim(), params);
    state.debugCallResult = JSON.stringify(res, null, 2);
  } catch (err) {
    state.debugCallError = String(err);
  }
}
