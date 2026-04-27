import { resolveActiveTalkProviderConfig } from "../../config/talk.js";
import type { GenesisConfig } from "../../config/types.js";

export { resolveActiveTalkProviderConfig };

export function getRuntimeConfigSnapshot(): GenesisConfig | null {
  return null;
}
