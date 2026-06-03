import { Type } from "typebox";
import { NonEmptyString } from "./primitives.js";

/**
 * A single MCP server definition. The transport-specific shape lives in
 * `src/config/types.mcp.ts` (`McpServerConfig`); the protocol passes it through
 * as an open object so new transport keys do not require a wire-contract bump.
 */
export const McpServerConfigSchema = Type.Object({}, { additionalProperties: true });

export const McpServersListParamsSchema = Type.Object({}, { additionalProperties: false });

export const McpServerSetParamsSchema = Type.Object(
  {
    name: NonEmptyString,
    server: McpServerConfigSchema,
  },
  { additionalProperties: false },
);

export const McpServerUnsetParamsSchema = Type.Object(
  {
    name: NonEmptyString,
  },
  { additionalProperties: false },
);

export const McpServersResultSchema = Type.Object(
  {
    path: Type.String(),
    servers: Type.Record(Type.String(), McpServerConfigSchema),
    /** Present on unset: whether a server was actually removed. */
    removed: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);
