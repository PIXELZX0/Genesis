import type { HealthSummary } from "../../commands/health.js";
import { defaultRuntime } from "../../runtime.js";
import { colorize, isRich, theme } from "../../terminal/theme.js";
import { callGatewayCli, type GatewayRpcOpts } from "./call.js";

export type GatewayHealthRouteOptions = Pick<
  GatewayRpcOpts,
  "url" | "token" | "password" | "timeout" | "expectFinal" | "json"
>;

export async function runGatewayHealthRoute(opts: GatewayHealthRouteOptions): Promise<void> {
  const [{ formatHealthChannelLines }, { styleHealthChannelLine }] = await Promise.all([
    import("../../commands/health.js"),
    import("../../terminal/health-style.js"),
  ]);
  const result = await callGatewayCli("health", opts);
  if (opts.json) {
    defaultRuntime.writeJson(result);
    return;
  }
  const rich = isRich();
  const obj: Record<string, unknown> = result && typeof result === "object" ? result : {};
  const durationMs = typeof obj.durationMs === "number" ? obj.durationMs : null;
  defaultRuntime.log(colorize(rich, theme.heading, "Gateway Health"));
  defaultRuntime.log(
    `${colorize(rich, theme.success, "OK")}${durationMs != null ? ` (${durationMs}ms)` : ""}`,
  );
  if (obj.channels && typeof obj.channels === "object") {
    for (const line of formatHealthChannelLines(obj as HealthSummary)) {
      defaultRuntime.log(styleHealthChannelLine(line, rich));
    }
  }
}
