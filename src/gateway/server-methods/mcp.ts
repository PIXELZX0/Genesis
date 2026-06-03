import {
  listConfiguredMcpServers,
  setConfiguredMcpServer,
  unsetConfiguredMcpServer,
} from "../../config/mcp-config.js";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  type McpServersResult,
  validateMcpServerSetParams,
  validateMcpServerUnsetParams,
  validateMcpServersListParams,
} from "../protocol/index.js";
import type { GatewayRequestHandlers } from "./types.js";

export const mcpHandlers: GatewayRequestHandlers = {
  "mcp.servers.list": async ({ params, respond }) => {
    if (!validateMcpServersListParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid mcp.servers.list params: ${formatValidationErrors(validateMcpServersListParams.errors)}`,
        ),
      );
      return;
    }
    const loaded = await listConfiguredMcpServers();
    if (!loaded.ok) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, loaded.error));
      return;
    }
    respond(
      true,
      { path: loaded.path, servers: loaded.mcpServers } satisfies McpServersResult,
      undefined,
    );
  },
  "mcp.servers.set": async ({ params, respond }) => {
    if (!validateMcpServerSetParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid mcp.servers.set params: ${formatValidationErrors(validateMcpServerSetParams.errors)}`,
        ),
      );
      return;
    }
    const result = await setConfiguredMcpServer({ name: params.name, server: params.server });
    if (!result.ok) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, result.error));
      return;
    }
    respond(
      true,
      { path: result.path, servers: result.mcpServers } satisfies McpServersResult,
      undefined,
    );
  },
  "mcp.servers.unset": async ({ params, respond }) => {
    if (!validateMcpServerUnsetParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid mcp.servers.unset params: ${formatValidationErrors(validateMcpServerUnsetParams.errors)}`,
        ),
      );
      return;
    }
    const result = await unsetConfiguredMcpServer({ name: params.name });
    if (!result.ok) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, result.error));
      return;
    }
    respond(
      true,
      {
        path: result.path,
        servers: result.mcpServers,
        removed: result.removed ?? false,
      } satisfies McpServersResult,
      undefined,
    );
  },
};
