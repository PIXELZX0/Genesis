import { describe, expect, it } from "vitest";
import {
  GATEWAY_CLIENT_CAPS,
  GATEWAY_CLIENT_IDS,
  GATEWAY_CLIENT_MODES,
  hasGatewayClientCap,
} from "./client-info.js";
import { validateConnectParams } from "./index.js";
import { PROTOCOL_VERSION } from "./version.js";

function makeControlUiConnectParams(caps?: string[]) {
  return {
    minProtocol: PROTOCOL_VERSION,
    maxProtocol: PROTOCOL_VERSION,
    client: {
      id: GATEWAY_CLIENT_IDS.CONTROL_UI,
      version: "test",
      platform: "web",
      mode: GATEWAY_CLIENT_MODES.WEBCHAT,
    },
    role: "operator",
    scopes: ["operator.read"],
    ...(caps ? { caps } : {}),
  };
}

describe("gateway client capabilities", () => {
  it("accepts legacy clients and additive scoped streaming caps at the same protocol version", () => {
    expect(validateConnectParams(makeControlUiConnectParams())).toBe(true);
    expect(
      validateConnectParams(
        makeControlUiConnectParams([
          GATEWAY_CLIENT_CAPS.SCOPED_SESSION_MESSAGES,
          GATEWAY_CLIENT_CAPS.SUPPRESS_ASSISTANT_AGENT_EVENTS,
        ]),
      ),
    ).toBe(true);
  });

  it("keeps unknown caps forward-compatible without enabling known behavior", () => {
    const caps = ["future-client-capability"];
    expect(validateConnectParams(makeControlUiConnectParams(caps))).toBe(true);
    expect(hasGatewayClientCap(caps, GATEWAY_CLIENT_CAPS.SCOPED_SESSION_MESSAGES)).toBe(false);
    expect(hasGatewayClientCap(caps, GATEWAY_CLIENT_CAPS.SUPPRESS_ASSISTANT_AGENT_EVENTS)).toBe(
      false,
    );
  });
});
