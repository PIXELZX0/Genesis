/**
 * Decide whether a `postMessage` event should be accepted as an MCP OAuth
 * callback from the gateway's own callback page.
 *
 * The callback page (`/mcp-oauth-callback.html`) is served same-origin by the
 * gateway, so a trusted message must:
 *  - carry our `source: "genesis-mcp-oauth"` tag, AND
 *  - originate from the gateway's own web origin.
 *
 * Some browsers report an opaque (`"null"`/empty) origin for popups in certain
 * sandboxing contexts. In that case we fall back to verifying the message came
 * from the popup window we opened. Everything else is rejected so a malicious
 * page cannot inject a forged authorization code.
 */
export function isTrustedMcpOAuthMessage(params: {
  origin: string;
  source: unknown;
  expectedOrigin: string;
  popup: unknown;
  dataSource: unknown;
}): boolean {
  if (params.dataSource !== "genesis-mcp-oauth") {
    return false;
  }
  const originTrusted = params.expectedOrigin !== "" && params.origin === params.expectedOrigin;
  if (originTrusted) {
    return true;
  }
  const opaqueOrigin = params.origin === "" || params.origin === "null";
  const fromOurPopup = params.popup != null && params.source === params.popup;
  return opaqueOrigin && fromOurPopup;
}
