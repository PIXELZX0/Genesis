import { listSkillCommandsForAgents as listSkillCommandsForAgentsImpl } from "genesis/plugin-sdk/command-auth";

type ListSkillCommandsForAgents =
  typeof import("genesis/plugin-sdk/command-auth").listSkillCommandsForAgents;

export function listSkillCommandsForAgents(
  ...args: Parameters<ListSkillCommandsForAgents>
): ReturnType<ListSkillCommandsForAgents> {
  return listSkillCommandsForAgentsImpl(...args);
}
