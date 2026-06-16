import type { GenesisConfig } from "../../config/types.genesis.js";
import { withStrictWebToolsEndpoint } from "./web-guarded-fetch.js";
import { resolveWebTorProxyUrl } from "./web-tor-shared.js";

const REDIRECT_TIMEOUT_MS = 5000;

/**
 * Resolve a citation redirect URL to its final destination using a HEAD request.
 * Returns the original URL if resolution fails or times out.
 */
export async function resolveCitationRedirectUrl(
  url: string,
  config?: GenesisConfig,
): Promise<string> {
  try {
    const torProxyUrl = resolveWebTorProxyUrl(config);
    return await withStrictWebToolsEndpoint(
      {
        url,
        init: { method: "HEAD" },
        timeoutMs: REDIRECT_TIMEOUT_MS,
        ...(torProxyUrl ? { torProxyUrl } : {}),
      },
      async ({ finalUrl }) => finalUrl || url,
    );
  } catch {
    return url;
  }
}
