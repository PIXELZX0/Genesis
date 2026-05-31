import { loadNodeHostConfig, saveNodeHostConfig } from "../node-host/config.js";
import type { WizardPrompter } from "./prompts.js";

export async function promptNodeHostConfig(
  prompter: WizardPrompter,
  remoteUrl: string,
): Promise<void> {
  const existing = await loadNodeHostConfig();

  const displayNameInput = await prompter.text({
    message: "Node display name (optional)",
    initialValue: existing?.displayName ?? "",
  });
  const displayName =
    typeof displayNameInput === "string" ? displayNameInput.trim() || undefined : undefined;

  const url = new URL(remoteUrl);
  const host = url.hostname;
  const port = url.port ? Number.parseInt(url.port, 10) : 18789;
  const tls = url.protocol === "wss:";

  await saveNodeHostConfig({
    version: 1,
    nodeId: existing?.nodeId ?? crypto.randomUUID(),
    token: existing?.token,
    displayName: displayName ?? existing?.displayName,
    gateway: {
      ...existing?.gateway,
      host,
      port,
      tls,
    },
  });
}
