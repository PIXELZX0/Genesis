// CLI-only bootstrap for the Matrix plugin runtime store.
//
// The standard plugin loader sets the Matrix runtime via the
// `defineBundledChannelEntry` runtime setter, but the CLI loader runs in
// "discovery" mode (`activate: false`) and never invokes that setter. CLI
// actions still need `getMatrixRuntime().config.loadConfig()` and a handful of
// other surfaces — so we install a minimal runtime here that wraps the core
// helpers exposed through the public Plugin SDK boundary.

import { loadConfig, writeConfigFile } from "genesis/plugin-sdk/config-runtime";
import {
  getChildLogger,
  normalizeLogLevel,
  shouldLogVerbose,
} from "genesis/plugin-sdk/runtime-env";
import { resolveStateDir } from "genesis/plugin-sdk/state-paths";
import type { PluginRuntime } from "./runtime-api.js";
import { setMatrixRuntime, tryGetMatrixRuntime } from "./runtime.js";

let bootstrapped = false;

export function ensureMatrixCliRuntime(): void {
  if (bootstrapped || tryGetMatrixRuntime() !== null) {
    bootstrapped = true;
    return;
  }
  setMatrixRuntime(buildMatrixCliRuntime());
  bootstrapped = true;
}

function buildMatrixCliRuntime(): PluginRuntime {
  const logging: PluginRuntime["logging"] = {
    shouldLogVerbose,
    getChildLogger: (bindings, opts) => {
      const logger = getChildLogger(bindings, {
        level: opts?.level ? normalizeLogLevel(opts.level) : undefined,
      });
      return {
        debug: (message) => logger.debug?.(message),
        info: (message) => logger.info(message),
        warn: (message) => logger.warn(message),
        error: (message) => logger.error(message),
      };
    },
  };
  return {
    config: {
      loadConfig,
      writeConfigFile,
    },
    state: {
      resolveStateDir,
    },
    logging,
  } as PluginRuntime;
}
