import {
  buildUsageHttpErrorSnapshot,
  clampPercent,
  fetchJson,
  PROVIDER_LABELS,
  type ProviderUsageSnapshot,
  type UsageWindow,
} from "genesis/plugin-sdk/provider-usage";

const PROVIDER_ID = "opencode-go" as const;
const USAGE_URL = "https://opencode.ai/zen/go/v1/usage";

type OpencodeGoUsageWindow = {
  status?: string;
  usagePercent?: number;
  resetInSec?: number;
};

type OpencodeGoUsageResponse = {
  rollingUsage?: OpencodeGoUsageWindow;
  weeklyUsage?: OpencodeGoUsageWindow;
  monthlyUsage?: OpencodeGoUsageWindow;
};

type OpencodeGoUsageErrorResponse = {
  error?: { message?: string };
};

function toUsageWindow(
  label: string,
  window: OpencodeGoUsageWindow | undefined,
  now: number,
): UsageWindow | undefined {
  if (!window || typeof window.usagePercent !== "number") {
    return undefined;
  }
  const resetInSec = window.resetInSec;
  return {
    label,
    usedPercent: clampPercent(window.usagePercent),
    ...(typeof resetInSec === "number" && resetInSec > 0
      ? { resetAt: now + resetInSec * 1000 }
      : {}),
  };
}

export async function fetchOpencodeGoUsage(
  apiKey: string,
  timeoutMs: number,
  fetchFn: typeof fetch,
  now: number = Date.now(),
): Promise<ProviderUsageSnapshot> {
  const res = await fetchJson(
    USAGE_URL,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
    },
    timeoutMs,
    fetchFn,
  );

  if (!res.ok) {
    // The endpoint reports "subscription required" on 403, which is worth
    // surfacing instead of a bare status code.
    const message = await res
      .json()
      .then((body) => (body as OpencodeGoUsageErrorResponse)?.error?.message)
      .catch(() => undefined);
    return buildUsageHttpErrorSnapshot({
      provider: PROVIDER_ID,
      status: res.status,
      ...(typeof message === "string" ? { message } : {}),
      tokenExpiredStatuses: [401],
    });
  }

  const data = (await res.json()) as OpencodeGoUsageResponse;
  const windows = [
    toUsageWindow("Rolling", data.rollingUsage, now),
    toUsageWindow("Weekly", data.weeklyUsage, now),
    toUsageWindow("Monthly", data.monthlyUsage, now),
  ].filter((window): window is UsageWindow => Boolean(window));

  return {
    provider: PROVIDER_ID,
    displayName: PROVIDER_LABELS[PROVIDER_ID],
    windows,
  };
}
