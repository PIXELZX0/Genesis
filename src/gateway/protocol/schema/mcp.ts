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
    /**
     * `window.location.origin` of the browser starting a popup OAuth flow.
     * Used to build a `redirect_uri` that the user's own browser can reach,
     * instead of the gateway's static (often loopback) web URL. Ignored by
     * the embedded (headless-browser) flow, which always uses the gateway's
     * own origin since the gateway process is the one navigating.
     */
    origin: Type.Optional(NonEmptyString),
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

/**
 * `mcp.oauth.refresh` — force a refresh-token exchange for a server's stored
 * access token. Admin-scoped, mirrors disconnect.
 */
export const McpOAuthRefreshParamsSchema = McpOAuthStatusParamsSchema;

export const McpOAuthRefreshResultSchema = Type.Object(
  {
    ok: Type.Boolean(),
    expiresAtMs: Type.Optional(Type.Union([Type.Null(), Type.Integer()])),
    message: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

/**
 * Embedded OAuth: the gateway drives a server-side headless browser and streams
 * screenshots to the Control UI, which relays pointer/keyboard input. Reuses the
 * same PKCE state and `completeMcpOAuthFlow` token exchange as the popup flow.
 * MVP transport is polling (`mcp.oauth.embedded.poll`) rather than events.
 */
const McpOAuthEmbeddedViewportSchema = Type.Object(
  {
    w: Type.Integer(),
    h: Type.Integer(),
  },
  { additionalProperties: false },
);

export const McpOAuthEmbeddedStartParamsSchema = Type.Object(
  {
    name: NonEmptyString,
    scopes: Type.Optional(Type.Array(Type.String())),
    viewport: Type.Optional(McpOAuthEmbeddedViewportSchema),
  },
  { additionalProperties: false },
);

export const McpOAuthEmbeddedStartResultSchema = Type.Object(
  {
    sessionId: NonEmptyString,
    viewport: McpOAuthEmbeddedViewportSchema,
    providerName: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const McpOAuthEmbeddedPollParamsSchema = Type.Object(
  {
    sessionId: NonEmptyString,
  },
  { additionalProperties: false },
);

export const McpOAuthEmbeddedPollResultSchema = Type.Object(
  {
    phase: Type.Union([
      Type.Literal("loading"),
      Type.Literal("interactive"),
      Type.Literal("done"),
      Type.Literal("error"),
    ]),
    seq: Type.Integer(),
    frame: Type.Optional(
      Type.Object(
        {
          dataBase64: Type.String(),
          w: Type.Integer(),
          h: Type.Integer(),
        },
        { additionalProperties: false },
      ),
    ),
    message: Type.Optional(Type.String()),
    providerName: Type.Optional(Type.String()),
    expiresAtMs: Type.Optional(Type.Union([Type.Null(), Type.Integer()])),
  },
  { additionalProperties: false },
);

export const McpOAuthEmbeddedInputParamsSchema = Type.Object(
  {
    sessionId: NonEmptyString,
    kind: Type.Union([Type.Literal("mouse"), Type.Literal("wheel"), Type.Literal("key")]),
    action: Type.Optional(
      Type.Union([
        Type.Literal("move"),
        Type.Literal("down"),
        Type.Literal("up"),
        Type.Literal("click"),
        Type.Literal("press"),
        Type.Literal("type"),
      ]),
    ),
    x: Type.Optional(Type.Number()),
    y: Type.Optional(Type.Number()),
    button: Type.Optional(
      Type.Union([Type.Literal("left"), Type.Literal("right"), Type.Literal("middle")]),
    ),
    deltaX: Type.Optional(Type.Number()),
    deltaY: Type.Optional(Type.Number()),
    text: Type.Optional(Type.String()),
    key: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const McpOAuthEmbeddedInputResultSchema = Type.Object(
  {
    ok: Type.Boolean(),
  },
  { additionalProperties: false },
);

export const McpOAuthEmbeddedCancelParamsSchema = McpOAuthEmbeddedPollParamsSchema;

export const McpOAuthEmbeddedCancelResultSchema = McpOAuthEmbeddedInputResultSchema;
