// Narrow barrel for the config API key resolver. Keep this separate from
// discovery.ts so setup/onboarding code does not pull in the AWS SDK, which
// is lazy-installed and may not be present yet.
import { resolveAwsSdkEnvVarName } from "genesis/plugin-sdk/provider-auth-runtime";

export function resolveBedrockConfigApiKey(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  // When no AWS auth env marker is present, Bedrock should fall back to the
  // AWS SDK default credential chain instead of persisting a fake apiKey marker.
  return resolveAwsSdkEnvVarName(env);
}
