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

/**
 * `mcp.servers.metadata` — fetch metadata for a remote MCP server by URL.
 * Used by the Control UI's "Add by link" flow to discover transport, name,
 * and OAuth metadata before saving a server config.
 */
export const McpServerMetadataParamsSchema = Type.Object(
  {
    url: NonEmptyString,
  },
  { additionalProperties: false },
);

export const McpServerMetadataResultSchema = Type.Object(
  {
    name: NonEmptyString,
    url: NonEmptyString,
    transport: Type.Union([Type.Literal("streamable-http"), Type.Literal("sse")]),
    serverName: Type.Optional(Type.String()),
    serverVersion: Type.Optional(Type.String()),
    protocolVersion: Type.Optional(Type.String()),
    capabilities: Type.Optional(
      Type.Object(
        {
          tools: Type.Optional(Type.Array(Type.String())),
          prompts: Type.Optional(Type.Array(Type.String())),
          resources: Type.Optional(Type.Array(Type.String())),
        },
        { additionalProperties: false },
      ),
    ),
    oauth: Type.Boolean(),
    oauthIssuer: Type.Optional(Type.String()),
    oauthAuthorizeUrl: Type.Optional(Type.String()),
    oauthTokenUrl: Type.Optional(Type.String()),
    oauthScopes: Type.Optional(Type.Array(Type.String())),
  },
  { additionalProperties: false },
);

/**
 * `mcp.servers.test` — probe a configured server to confirm reachability and
 * that the saved credentials (headers or OAuth) are accepted.
 */
export const McpServerTestParamsSchema = Type.Object(
  {
    name: NonEmptyString,
  },
  { additionalProperties: false },
);

export const McpServerTestResultSchema = Type.Object(
  {
    ok: Type.Boolean(),
    message: Type.String(),
  },
  { additionalProperties: false },
);

/**
 * OAuth flow methods. Genesis acts as a confidential client and stores
 * encrypted tokens in `~/.genesis/mcp-tokens.json`.
 */
export const McpOAuthStartParamsSchema = Type.Object(
  {
    name: NonEmptyString,
    scopes: Type.Optional(Type.Array(Type.String())),
  },
  { additionalProperties: false },
);

export const McpOAuthStartResultSchema = Type.Object(
  {
    state: NonEmptyString,
    authorizeUrl: NonEmptyString,
    providerName: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const McpOAuthCallbackParamsSchema = Type.Object(
  {
    name: NonEmptyString,
    state: NonEmptyString,
    code: NonEmptyString,
  },
  { additionalProperties: false },
);

export const McpOAuthCallbackResultSchema = Type.Object(
  {
    ok: Type.Boolean(),
    message: Type.Optional(Type.String()),
    providerName: Type.Optional(Type.String()),
    expiresAtMs: Type.Optional(Type.Union([Type.Null(), Type.Integer()])),
  },
  { additionalProperties: false },
);

export const McpOAuthStatusParamsSchema = Type.Object(
  {
    name: NonEmptyString,
  },
  { additionalProperties: false },
);

export const McpOAuthStatusResultSchema = Type.Object(
  {
    connected: Type.Boolean(),
    expiresAtMs: Type.Optional(Type.Union([Type.Null(), Type.Integer()])),
    providerName: Type.Optional(Type.String()),
    requiresAuth: Type.Boolean(),
  },
  { additionalProperties: false },
);

export const McpOAuthDisconnectParamsSchema = McpOAuthStatusParamsSchema;
