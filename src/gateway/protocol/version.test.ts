import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PROTOCOL_VERSION as SCHEMA_PROTOCOL_VERSION } from "./schema.js";
import { PROTOCOL_VERSION } from "./version.js";

function readRepoFile(path: string): string {
  return readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");
}

describe("gateway protocol version", () => {
  it("keeps schema re-exports on the shared constant", () => {
    expect(SCHEMA_PROTOCOL_VERSION).toBe(PROTOCOL_VERSION);
  });

  it("keeps native and shell gateway clients aligned", () => {
    const androidProtocol = readRepoFile(
      "apps/android/app/src/main/java/ai/genesis/app/gateway/GatewayProtocol.kt",
    );
    const dockerNetworkSmoke = readRepoFile("scripts/e2e/gateway-network-docker.sh");

    expect(androidProtocol).toContain(`GATEWAY_PROTOCOL_VERSION = ${PROTOCOL_VERSION}`);
    expect(dockerNetworkSmoke).toContain(`const PROTOCOL_VERSION = ${PROTOCOL_VERSION};`);
  });
});
