import { Type } from "typebox";
import { readSnakeCaseParamRaw } from "../../param-key.js";
import { stringEnum } from "../schema/typebox.js";
import { type AnyAgentTool, jsonResult, readStringParam } from "./common.js";
import { callGatewayTool, readGatewayCallOptions } from "./gateway.js";
import { isGenesisOwnerOnlyCoreToolName } from "./owner-only-tools.js";

const AGENTS_MANAGE_ACTIONS = ["list", "create", "update", "delete"] as const;

// Keep this flat because some model providers reject nested union schemas.
// Action-specific requirements are validated before the Gateway RPC call.
const AgentsManageToolSchema = Type.Object({
  action: stringEnum(AGENTS_MANAGE_ACTIONS),
  gatewayUrl: Type.Optional(Type.String()),
  gatewayToken: Type.Optional(Type.String()),
  timeoutMs: Type.Optional(Type.Number()),
  agentId: Type.Optional(Type.String()),
  name: Type.Optional(Type.String()),
  workspace: Type.Optional(Type.String()),
  model: Type.Optional(Type.String()),
  emoji: Type.Optional(Type.String()),
  avatar: Type.Optional(Type.String()),
  deleteFiles: Type.Optional(Type.Boolean()),
});

function optionalParam(params: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = readSnakeCaseParamRaw(params, key);
  return value === undefined ? {} : { [key]: value };
}

export function createAgentsManageTool(): AnyAgentTool {
  return {
    label: "Agents",
    name: "agents_manage",
    ownerOnly: isGenesisOwnerOnlyCoreToolName("agents_manage"),
    description:
      "Manage persistent Genesis agents through Gateway RPCs. Owner-only control-plane tool. Use action=list to inspect agents, create to add one (name and workspace required), update to change one (agentId required), or delete to remove one (agentId required).",
    parameters: AgentsManageToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action", { required: true });
      const gatewayOpts = readGatewayCallOptions(params);

      switch (action) {
        case "list":
          return jsonResult(await callGatewayTool("agents.list", gatewayOpts, {}));
        case "create": {
          const name = readStringParam(params, "name", { required: true });
          const workspace = readStringParam(params, "workspace", { required: true });
          return jsonResult(
            await callGatewayTool("agents.create", gatewayOpts, {
              name,
              workspace,
              ...optionalParam(params, "model"),
              ...optionalParam(params, "emoji"),
              ...optionalParam(params, "avatar"),
            }),
          );
        }
        case "update": {
          const agentId = readStringParam(params, "agentId", { required: true });
          return jsonResult(
            await callGatewayTool("agents.update", gatewayOpts, {
              agentId,
              ...optionalParam(params, "name"),
              ...optionalParam(params, "workspace"),
              ...optionalParam(params, "model"),
              ...optionalParam(params, "emoji"),
              ...optionalParam(params, "avatar"),
            }),
          );
        }
        case "delete": {
          const agentId = readStringParam(params, "agentId", { required: true });
          return jsonResult(
            await callGatewayTool("agents.delete", gatewayOpts, {
              agentId,
              ...optionalParam(params, "deleteFiles"),
            }),
          );
        }
        default:
          throw new Error(`Unknown action: ${action}`);
      }
    },
  };
}
