import { definePluginEntry } from "genesis/plugin-sdk/plugin-entry";
import { startGatewayBonjourAdvertiser } from "./src/advertiser.js";

function formatBonjourInstanceName(displayName: string) {
  const trimmed = displayName.trim();
  if (!trimmed) {
    return "Genesis";
  }
  if (/genesis/i.test(trimmed)) {
    return trimmed;
  }
  return `${trimmed} (Genesis)`;
}

export default definePluginEntry({
  id: "bonjour",
  name: "Bonjour Gateway Discovery",
  description: "Advertise the local Genesis gateway over Bonjour/mDNS.",
  register(api) {
    api.registerGatewayDiscoveryService({
      id: "bonjour",
      advertise: async (ctx) => {
        const advertiser = await startGatewayBonjourAdvertiser(
          {
            instanceName: formatBonjourInstanceName(ctx.machineDisplayName),
            gatewayPort: ctx.gatewayPort,
            gatewayTlsEnabled: ctx.gatewayTlsEnabled,
            gatewayTlsFingerprintSha256: ctx.gatewayTlsFingerprintSha256,
            canvasPort: ctx.canvasPort,
            sshPort: ctx.sshPort,
            tailnetDns: ctx.tailnetDns,
            cliPath: ctx.cliPath,
            minimal: ctx.minimal,
          },
          { logger: api.logger },
        );
        return { stop: advertiser.stop };
      },
    });
  },
});
