import { openaiCodexProvider } from "@earendil-works/pi-ai/providers/openai-codex";
import { ensureGlobalUndiciEnvProxyDispatcher } from "genesis/plugin-sdk/runtime-env";

type OpenAICodexRefreshed = {
  access: string;
  refresh: string;
  expires: number;
  accountId?: string;
  [key: string]: unknown;
};

export async function refreshOpenAICodexToken(refreshToken: string): Promise<OpenAICodexRefreshed> {
  ensureGlobalUndiciEnvProxyDispatcher();
  const oauth = openaiCodexProvider().auth.oauth;
  if (!oauth) {
    throw new Error("OpenAI Codex OAuth flow is not available in this build");
  }
  const refreshed = await oauth.refresh({
    type: "oauth",
    access: "",
    refresh: refreshToken,
    expires: 0,
  });
  return {
    access: refreshed.access,
    refresh: refreshed.refresh,
    expires: refreshed.expires,
    ...(refreshed as Record<string, unknown>),
  };
}

export async function getOAuthApiKey(): Promise<never> {
  ensureGlobalUndiciEnvProxyDispatcher();
  throw new Error(
    "getOAuthApiKey from pi-ai/oauth is no longer available in 0.81+. Use loginOpenAICodexOAuth for the full interactive flow instead.",
  );
}
