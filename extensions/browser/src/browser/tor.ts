import { type ChildProcess, type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { prepareOomScoreAdjustedSpawn } from "genesis/plugin-sdk/process-runtime";
import { ensurePortAvailable } from "../infra/ports.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { CONFIG_DIR } from "../utils.js";
import type { ResolvedBrowserTorConfig } from "./config.js";

const log = createSubsystemLogger("browser").child("tor");
const TOR_READY_TIMEOUT_MS = 30_000;
const TOR_READY_POLL_MS = 100;
const TOR_STOP_TIMEOUT_MS = 5_000;
const TOR_OUTPUT_HINT_MAX_CHARS = 4_000;

export type RunningTor = {
  pid: number;
  socksHost: string;
  socksPort: number;
  dataDir: string;
  startedAt: number;
  executablePath: string;
  proc: ChildProcess;
};

export function resolveGenesisTorDataDir(profileName: string): string {
  return path.join(CONFIG_DIR, "browser", profileName, "tor-data");
}

export function buildTorChromeProxyArgs(tor: ResolvedBrowserTorConfig | undefined): string[] {
  if (!tor?.enabled) {
    return [];
  }
  return [
    `--proxy-server=socks5://${tor.socksHost}:${tor.socksPort}`,
    `--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE ${tor.socksHost}`,
  ];
}

function canConnectToTcpPort(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const socket = net.createConnection({ host, port });
    let settled = false;
    const finish = (value: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

export async function waitForTorSocksEndpoint(
  tor: Pick<ResolvedBrowserTorConfig, "socksHost" | "socksPort">,
  timeoutMs = TOR_READY_TIMEOUT_MS,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const remainingMs = Math.max(1, deadline - Date.now());
    if (await canConnectToTcpPort(tor.socksHost, tor.socksPort, Math.min(500, remainingMs))) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, TOR_READY_POLL_MS));
  }
  return false;
}

async function waitForProcessExit(proc: ChildProcess, timeoutMs: number): Promise<void> {
  if (proc.exitCode != null || proc.signalCode != null || proc.killed) {
    return;
  }
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      proc.off("exit", onExit);
      proc.off("close", onExit);
      resolve();
    }, timeoutMs);
    const onExit = () => {
      clearTimeout(timer);
      resolve();
    };
    proc.once("exit", onExit);
    proc.once("close", onExit);
  });
}

export async function startManagedTor(
  profileName: string,
  tor: ResolvedBrowserTorConfig,
): Promise<RunningTor | null> {
  if (tor.mode !== "managed") {
    if (!(await waitForTorSocksEndpoint(tor, 1_500))) {
      throw new Error(
        `Tor SOCKS endpoint for profile "${profileName}" is not reachable at ${tor.socksHost}:${tor.socksPort}.`,
      );
    }
    return null;
  }

  await ensurePortAvailable(tor.socksPort);
  const dataDir = tor.dataDir ?? resolveGenesisTorDataDir(profileName);
  fs.mkdirSync(dataDir, { recursive: true });

  const executablePath = tor.executablePath ?? "tor";
  const args = [
    "--SocksPort",
    `${tor.socksHost}:${tor.socksPort}`,
    "--DataDirectory",
    dataDir,
    ...tor.extraArgs,
  ];
  const preparedSpawn = prepareOomScoreAdjustedSpawn(executablePath, args, {
    env: process.env,
  });
  const proc = spawn(preparedSpawn.command, preparedSpawn.args, {
    stdio: ["ignore", "pipe", "pipe"],
    env: preparedSpawn.env,
  }) as unknown as ChildProcessWithoutNullStreams;

  const outputChunks: Buffer[] = [];
  const onOutput = (chunk: Buffer) => {
    outputChunks.push(chunk);
  };
  proc.stdout?.on("data", onOutput);
  proc.stderr?.on("data", onOutput);

  let spawnError: unknown;
  proc.once("error", (err) => {
    spawnError = err;
  });

  const ready = await waitForTorSocksEndpoint(tor);
  if (!ready) {
    try {
      proc.kill("SIGKILL");
    } catch {
      // ignore
    }
    const output = Buffer.concat(outputChunks).toString("utf8").slice(0, TOR_OUTPUT_HINT_MAX_CHARS);
    const detail = spawnError instanceof Error ? ` ${spawnError.message}` : "";
    throw new Error(
      `Tor did not become ready for profile "${profileName}" at ${tor.socksHost}:${tor.socksPort}.${detail}${output ? `\nTor output:\n${output}` : ""}`,
    );
  }

  proc.stdout?.off("data", onOutput);
  proc.stderr?.off("data", onOutput);
  outputChunks.length = 0;

  const pid = proc.pid ?? -1;
  log.info(
    `Tor sidecar started for browser profile "${profileName}" on ${tor.socksHost}:${tor.socksPort} (pid ${pid})`,
  );
  return {
    pid,
    socksHost: tor.socksHost,
    socksPort: tor.socksPort,
    dataDir,
    startedAt: Date.now(),
    executablePath,
    proc,
  };
}

export async function stopManagedTor(running: RunningTor | null | undefined): Promise<void> {
  if (!running || running.proc.killed) {
    return;
  }
  try {
    running.proc.kill("SIGTERM");
  } catch {
    // ignore
  }
  await waitForProcessExit(running.proc, TOR_STOP_TIMEOUT_MS);
  if (running.proc.exitCode == null && running.proc.signalCode == null) {
    try {
      running.proc.kill("SIGKILL");
    } catch {
      // ignore
    }
  }
}
