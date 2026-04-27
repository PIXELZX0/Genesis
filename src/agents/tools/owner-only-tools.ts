export const GENESIS_OWNER_ONLY_CORE_TOOL_NAMES = ["cron", "gateway", "nodes"] as const;

const GENESIS_OWNER_ONLY_CORE_TOOL_NAME_SET: ReadonlySet<string> = new Set(
  GENESIS_OWNER_ONLY_CORE_TOOL_NAMES,
);

export function isGenesisOwnerOnlyCoreToolName(toolName: string): boolean {
  return GENESIS_OWNER_ONLY_CORE_TOOL_NAME_SET.has(toolName);
}
