---
summary: "How Genesis runs the OAuth flow for remote MCP servers, where tokens are stored, and how to configure providers manually"
read_when:
  - Connecting a remote MCP server that requires OAuth (Notion, Linear, Slack, and similar)
  - Debugging the Control UI MCP OAuth popup flow
  - Configuring a self-hosted MCP server behind a private network
  - Enabling the embedded server-side headless-browser sign-in flow
title: "MCP OAuth"
---

Remote MCP servers increasingly require OAuth 2.0 instead of a static bearer
token. Genesis runs the authorization-code flow from the Control UI, stores the
resulting tokens encrypted on the gateway host, and refreshes them
automatically.

## Flow

```mermaid
sequenceDiagram
    participant UI as Control UI
    participant GW as Gateway
    participant P as OAuth provider
    UI->>GW: mcp.oauth.start
    GW-->>UI: authorize URL (PKCE S256)
    UI->>P: open popup to authorize URL
    P-->>UI: redirect to /mcp-oauth-callback.html?code&state
    UI->>UI: callback page postMessage(code, state)
    UI->>GW: mcp.oauth.callback (code, state)
    GW->>P: exchange code + verifier for tokens
    GW-->>UI: connected
```

1. The operator clicks **Connect** on an OAuth-required server in the Control UI.
2. `mcp.oauth.start` builds the provider authorize URL. Genesis generates a PKCE
   verifier and sends the S256 challenge; the verifier is bound to the request
   `state` and never leaves the gateway.
3. A popup opens the provider consent screen. The redirect URI sent with the
   authorize request is built from the popup-opening browser's own origin (not
   the gateway's statically resolved web URL), so it still resolves correctly
   when the operator reaches the Control UI over a LAN address, tailnet
   hostname, or tunnel domain that differs from the gateway's own view of
   itself. After consent the provider redirects to that origin's
   gateway-served callback page at `/mcp-oauth-callback.html`.
4. The callback page posts the `code` and `state` back to the Control UI. The UI
   only accepts that message when it comes from the gateway origin (see
   [Callback origin checks](#callback-origin-checks)).
5. `mcp.oauth.callback` exchanges the code (plus the PKCE verifier and any client
   secret) at the token endpoint and stores the resulting tokens.

## Embedded browser flow

By default the operator authorizes in their own browser (the popup above). When
the Control UI is accessed remotely and the provider redirect cannot reach the
operator's browser, Genesis can instead run the sign-in inside a headless
browser on the gateway and stream it into its own popup window — the same UX
as the real-browser flow, just backed by a remote session. When the operator
clicks **Connect**, the UI tries `mcp.oauth.embedded.start` first and falls
back to the real-browser popup flow if the gateway reports it unavailable (or
if the streaming popup itself is blocked by the browser's popup blocker).

```mermaid
sequenceDiagram
    participant UI as Control UI
    participant GW as Gateway
    participant B as Headless browser
    participant P as OAuth provider
    UI->>GW: mcp.oauth.embedded.start
    GW->>B: launch, navigate to authorize URL (PKCE S256)
    loop until done
        UI->>GW: mcp.oauth.embedded.poll
        GW-->>UI: phase + JPEG frame
        UI->>GW: mcp.oauth.embedded.input (pointer/key)
        GW->>B: relay input
    end
    P-->>B: redirect to /mcp-oauth-callback.html?code&state
    GW->>P: exchange code + verifier for tokens
    GW-->>UI: phase=done, connected
```

The embedded path reuses the same PKCE state and token exchange as the popup
flow — only the front end differs. The browser runs with an ephemeral profile
that is deleted on teardown, one flow per connection, and a hard timeout. All
four `mcp.oauth.embedded.*` methods are admin-scoped.

### Enabling it

The gateway needs a Chromium/Chrome executable and the `puppeteer-core` package.
`puppeteer-core` is an optional runtime dependency that is not installed by
default; install it on the gateway host (`pnpm add puppeteer-core`, or your
package manager of choice) to enable the embedded flow. It is imported lazily,
so when it is absent the gateway simply reports the flow unavailable. Chromium
resolution order is the configured path, then `PUPPETEER_EXECUTABLE_PATH` /
`CHROME_PATH` / `CHROMIUM_PATH`, then platform defaults.

```json
{
  "mcp": {
    "embeddedOAuth": {
      "chromiumPath": "/usr/bin/chromium"
    }
  }
}
```

When no Chromium resolves (for example mobile-node or mac-app gateways), the
embedded flow is unavailable and the UI uses the popup flow.

### Security tradeoffs

Unlike the popup flow, provider credentials are entered into a browser running
on the gateway host and screenshots of those pages stream over the connection.
This is a larger trust surface: prefer it only on a gateway you control, always
over TLS. Many providers also block headless browsers (captcha, device
verification), in which case the sign-in will fail and you should use the popup
flow or a provider that supports it. For a lighter alternative without
credential transit, an RFC 8628 device-code flow is the recommended direction.

## Token storage

Tokens live on the gateway host, never in the browser:

- File: `~/.genesis/mcp-oauth.json`, written atomically with `0600` permissions.
- Encryption: the file is encrypted at rest with AES-256-GCM under a
  machine-local key at `~/.genesis/mcp-oauth.key` (also `0600`). If the key is
  missing or the file cannot be decrypted, Genesis treats the server as
  not connected and never deletes the file, so an operator can investigate.
- Redaction: server configs written to logs strip `auth.clientSecret` and any
  `Authorization` header.

Legacy plaintext stores from earlier builds are read transparently and
re-encrypted on the next write.

## Refresh and revoke

- Tokens are refreshed automatically when a request finds them within 60 seconds
  of expiry, using the stored refresh token (RFC 6749 section 6). A new refresh
  token is adopted when the provider issues one; otherwise the existing one is
  kept.
- `mcp.oauth.refresh` (admin scope) forces a refresh on demand.
- Disconnecting a server makes a best-effort RFC 7009 revocation call when a
  `revokeUrl` is known, then removes the local token. Revocation failures never
  block disconnect.

## Discovery

When you add a server by link, Genesis probes it for OAuth requirements:

1. The standard `/.well-known/oauth-authorization-server` and
   `/.well-known/openid-configuration` metadata under the server origin.
2. RFC 9728 `/.well-known/oauth-protected-resource`, following the first
   advertised authorization server to its metadata.
3. An unauthenticated `initialize` probe. A `401` with a `WWW-Authenticate:
Bearer` challenge (or a JSON-RPC authorization error) marks the server as
   OAuth-required and, when present, the `resource_metadata` hint is followed.

## Manual configuration

If a provider is not auto-detected, set the auth block directly under
`mcp.servers.<name>.auth` (JSON tab in the Control UI, or the config file):

```json
{
  "mcp": {
    "servers": {
      "notion": {
        "url": "https://mcp.notion.com/mcp",
        "auth": {
          "authorizeUrl": "https://api.notion.com/v1/oauth/authorize",
          "tokenUrl": "https://api.notion.com/v1/oauth/token",
          "clientId": "your-registered-client-id",
          "clientSecret": "your-client-secret",
          "scopes": ["read", "write"],
          "revokeUrl": "https://api.notion.com/v1/oauth/revoke",
          "usePkce": true
        }
      }
    }
  }
}
```

- `clientId` must be the id you registered with the provider. When omitted,
  Genesis falls back to a generic identifier that most providers will reject.
- `usePkce` defaults to `true`. Set it to `false` only for providers that do not
  support PKCE.
- `clientSecret` is optional for public clients that rely on PKCE alone.

## Self-hosted servers

Outbound metadata and OAuth requests are SSRF-guarded: by default Genesis blocks
private, loopback, link-local, and other internal addresses, and pins DNS to
prevent rebinding. To reach an MCP server on a private network, allow its
hostname explicitly:

```json
{
  "mcp": {
    "metadataFetch": {
      "allowedHosts": ["mcp.internal.example"]
    }
  }
}
```

Listing a host exempts it from the private-address block. Leave this empty unless
you operate the target server.

## Callback origin checks

The callback page is served same-origin by the gateway. The Control UI accepts a
callback message only when it carries the Genesis source tag and originates from
the gateway web origin. When a browser reports an opaque origin for the popup,
the UI falls back to verifying the message came from the popup window it opened.
This prevents a malicious page from injecting a forged authorization code.

## Related

- [MCP CLI and server definitions](/cli/mcp)
- [Gateway remote access](/gateway/remote)
- [Troubleshooting](/help/troubleshooting)
