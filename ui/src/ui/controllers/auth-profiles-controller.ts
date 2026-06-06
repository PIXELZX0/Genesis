/**
 * Thin controller around the `models.authProfile*` gateway RPCs. Exposes a
 * typed API for the auth-profiles view: add/remove/rename/setPriority/
 * reorder. Does not cold-load any plugin runtime — the gateway handles all
 * locking and persistence.
 */

import type { ModelAuthStatusResult, ModelAuthStatusProvider } from "../types.js";

export type AuthProfileAddParams = {
  profileId: string;
  provider: string;
  mode: "api_key" | "oauth" | "token";
  value?: string;
  valueRef?: unknown;
  displayName?: string;
  priority?: number;
};

export type AuthProfileClient = {
  request<T = unknown>(method: string, params?: unknown): Promise<T>;
};

export type AuthProfileControllerOptions = {
  client: AuthProfileClient;
};

export class AuthProfileController {
  readonly #client: AuthProfileClient;

  constructor(options: AuthProfileControllerOptions) {
    this.#client = options.client;
  }

  async add(params: AuthProfileAddParams): Promise<{ profileId: string; provider?: string }> {
    return await this.#client.request("models.authProfileAdd", params);
  }

  async remove(profileId: string): Promise<{ profileId: string; removed: boolean }> {
    return await this.#client.request("models.authProfileRemove", { profileId });
  }

  async rename(
    profileId: string,
    displayName: string,
  ): Promise<{ profileId: string; displayName: string }> {
    return await this.#client.request("models.authProfileRename", { profileId, displayName });
  }

  async setPriority(
    profileId: string,
    priority: number | null,
  ): Promise<{ profileId: string; priority: number | null }> {
    return await this.#client.request("models.authProfileSetPriority", { profileId, priority });
  }

  async reorder(
    provider: string,
    profileIds: string[],
  ): Promise<{ provider: string; profileIds: string[] }> {
    return await this.#client.request("models.authProfileReorder", { provider, profileIds });
  }

  async list(): Promise<ModelAuthStatusResult> {
    return await this.#client.request<ModelAuthStatusResult>("models.authStatus", {
      refresh: true,
    });
  }
}

/**
 * Project a status payload into the per-provider view shape the UI consumes.
 * Each `provider.profiles[i]` is enriched with its `displayName` and
 * `priority` from the wire (or `undefined` if unset). Kept pure so the view
 * tests can assert on a stable projection.
 */
export function projectStatusToProviders(status: ModelAuthStatusResult): ModelAuthStatusProvider[] {
  return status.providers.map((prov) => ({
    ...prov,
    profiles: prov.profiles.map((profile) => ({
      ...profile,
      displayName: profile.displayName ?? profile.profileId,
    })),
  }));
}
