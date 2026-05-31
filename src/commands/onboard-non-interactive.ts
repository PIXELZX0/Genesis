import { formatCliCommand } from "../cli/command-format.js";
import { readConfigFileSnapshot } from "../config/io.js";
import type { GenesisConfig } from "../config/types.genesis.js";
import type { RuntimeEnv } from "../runtime.js";
import { defaultRuntime } from "../runtime.js";
import { runNonInteractiveLocalSetup } from "./onboard-non-interactive/local.js";
import { runNonInteractiveNodeSetup } from "./onboard-non-interactive/node.js";
import { runNonInteractiveRemoteSetup } from "./onboard-non-interactive/remote.js";
import type { OnboardOptions } from "./onboard-types.js";

export async function runNonInteractiveSetup(
  opts: OnboardOptions,
  runtime: RuntimeEnv = defaultRuntime,
) {
  const snapshot = await readConfigFileSnapshot();
  if (snapshot.exists && !snapshot.valid) {
    runtime.error(
      `Config invalid. Run \`${formatCliCommand("genesis doctor")}\` to repair it, then re-run setup.`,
    );
    runtime.exit(1);
    return;
  }

  const baseConfig: GenesisConfig = snapshot.valid
    ? snapshot.exists
      ? (snapshot.sourceConfig ?? snapshot.config)
      : {}
    : {};
  const mode = opts.mode ?? "local";
  if (mode !== "local" && mode !== "remote" && mode !== "gateway" && mode !== "node") {
    runtime.error(`Invalid --mode "${String(mode)}" (use local|remote|gateway|node).`);
    runtime.exit(1);
    return;
  }

  if (mode === "remote") {
    await runNonInteractiveRemoteSetup({ opts, runtime, baseConfig, baseHash: snapshot.hash });
    return;
  }

  if (mode === "node") {
    await runNonInteractiveNodeSetup({ opts, runtime, baseConfig, baseHash: snapshot.hash });
    return;
  }

  await runNonInteractiveLocalSetup({ opts, runtime, baseConfig, baseHash: snapshot.hash });
}
