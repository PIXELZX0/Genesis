import type { Command } from "commander";
import {
  addGatewayClientOptions,
  callGatewayFromCli,
  type GatewayRpcOpts,
} from "genesis/plugin-sdk/browser-node-runtime";

export function registerVoiceAgentCli(program: Command) {
  const root = program
    .command("voice-agent")
    .description("Talk to an agent through gateway or node microphones and speakers");

  const call = async (method: string, opts: GatewayRpcOpts, params?: Record<string, unknown>) => {
    console.log(JSON.stringify(await callGatewayFromCli(method, opts, params), null, 2));
  };

  addGatewayClientOptions(
    root
      .command("start")
      .description("Start listening (gateway host by default)")
      .option("--node <id>", "Use a paired node's microphone/speaker"),
  ).action((opts: GatewayRpcOpts & { node?: string }) =>
    call("voiceagent.start", opts, opts.node ? { node: opts.node } : {}),
  );

  addGatewayClientOptions(
    root
      .command("stop")
      .description("Stop listening (all targets by default)")
      .option("--node <id>", "Only stop the session for this node"),
  ).action((opts: GatewayRpcOpts & { node?: string }) =>
    call("voiceagent.stop", opts, opts.node ? { node: opts.node } : {}),
  );

  addGatewayClientOptions(root.command("status").description("Show active voice sessions")).action(
    (opts: GatewayRpcOpts) => call("voiceagent.status", opts),
  );
}
