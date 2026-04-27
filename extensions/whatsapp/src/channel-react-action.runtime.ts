import { readStringOrNumberParam, readStringParam } from "genesis/plugin-sdk/channel-actions";
import type { GenesisConfig } from "genesis/plugin-sdk/config-runtime";

export { resolveReactionMessageId } from "genesis/plugin-sdk/channel-actions";
export { handleWhatsAppAction } from "./action-runtime.js";
export { isWhatsAppGroupJid, normalizeWhatsAppTarget } from "./normalize.js";
export { readStringOrNumberParam, readStringParam, type GenesisConfig };
