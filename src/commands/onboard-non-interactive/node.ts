import { formatCliCommand } from "../../cli/command-format.js";
import { replaceConfigFile } from "../../config/config.js";
import { logConfigUpdated } from "../../config/logging.js";
import type { GenesisConfig } from "../../config/types.genesis.js";
import { loadNodeHostConfig, saveNodeHostConfig } from "../../node-host/config.js";
import { type RuntimeEnv, writeRuntimeJson } from "../../runtime.js";
import { normalizeOptionalString } from "../../shared/string-coerce.js";
import { applySkipBootstrapConfig } from "../onboard-config.js";
import { applyWizardMetadata } from "../onboard-helpers.js";
import type { OnboardOptions } from "../onboard-types.js";

export async function runNonInteractiveNodeSetup(params: {
  opts: OnboardOptions;
  runtime: RuntimeEnv;
  baseConfig: GenesisConfig;
  baseHash?: string;
}) {
  const { opts, runtime, baseConfig, baseHash } = params;
  const mode = "node" as const;

  const remoteUrl = normalizeOptionalString(opts.remoteUrl);
  if (!remoteUrl) {
    runtime.error("Missing --remote-url for node mode.");
    runtime.exit(1);
    return;
  }

  let nextConfig: GenesisConfig = {
    ...baseConfig,
    gateway: {
      ...baseConfig.gateway,
      mode: "remote",
      remote: {
        url: remoteUrl,
        token: normalizeOptionalString(opts.remoteToken),
      },
    },
  };
  if (opts.skipBootstrap) {
    nextConfig = applySkipBootstrapConfig(nextConfig);
  }

  // Parse remote URL to extract host/port for node-host config
  const url = new URL(remoteUrl);
  const host = url.hostname;
  const port = url.port ? Number.parseInt(url.port, 10) : 18789;
  const tls = url.protocol === "wss:";

  const existingNodeConfig = await loadNodeHostConfig();
  await saveNodeHostConfig({
    version: 1,
    nodeId: existingNodeConfig?.nodeId ?? crypto.randomUUID(),
    token: existingNodeConfig?.token,
    displayName: existingNodeConfig?.displayName,
    gateway: {
      ...existingNodeConfig?.gateway,
      host,
      port,
      tls,
    },
  });

  nextConfig = applyWizardMetadata(nextConfig, { command: "onboard", mode });
  await replaceConfigFile({
    nextConfig,
    ...(baseHash !== undefined ? { baseHash } : {}),
  });
  logConfigUpdated(runtime);

  if (opts.installDaemon) {
    const { runNodeDaemonInstall } = await import("../../cli/node-cli/daemon.js");
    await runNodeDaemonInstall({
      host,
      port,
      tls,
      json: opts.json,
    });
  }

  const payload = {
    mode,
    remoteUrl,
    auth: opts.remoteToken ? "token" : "none",
    nodeHost: {
      host,
      port,
      tls,
    },
  };
  if (opts.json) {
    writeRuntimeJson(runtime, payload);
  } else {
    runtime.log(`Node mode configured.`);
    runtime.log(`Remote gateway: ${remoteUrl}`);
    runtime.log(`Auth: ${payload.auth}`);
    if (opts.installDaemon) {
      runtime.log(`Node daemon install requested.`);
    }
    runtime.log(
      `Tip: run \`${formatCliCommand("genesis configure --section web")}\` to store your Brave API key for web_search. Docs: https://genesis.pixelzx.com/docs/tools/web`,
    );
  }
}
