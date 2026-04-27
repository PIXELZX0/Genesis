import type { GenesisConfig } from "../../config/types.genesis.js";
import type { MsgContext } from "../templating.js";
import { buildCommandTestParams as buildBaseCommandTestParams } from "./commands.test-harness.js";

export function buildCommandTestParams(
  commandBody: string,
  cfg: GenesisConfig,
  ctxOverrides?: Partial<MsgContext>,
) {
  return buildBaseCommandTestParams(commandBody, cfg, ctxOverrides);
}
