import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";

// Mic capture: 16 kHz mono PCM16 (matches ElevenLabs `pcm_16000`).
export const VOICE_AGENT_INPUT_SAMPLE_RATE = 16_000;
export const DEFAULT_VOICE_AGENT_AUDIO_INPUT_COMMAND = [
  "rec",
  "-q",
  "-t",
  "raw",
  "-r",
  String(VOICE_AGENT_INPUT_SAMPLE_RATE),
  "-c",
  "1",
  "-e",
  "signed-integer",
  "-b",
  "16",
  "-",
];
// `{sampleRate}` is replaced per utterance with the TTS output rate.
export const DEFAULT_VOICE_AGENT_AUDIO_OUTPUT_COMMAND = [
  "play",
  "-q",
  "-t",
  "raw",
  "-r",
  "{sampleRate}",
  "-c",
  "1",
  "-e",
  "signed-integer",
  "-b",
  "16",
  "-",
];

export const VOICE_AGENT_NODE_COMMAND = "voiceagent.audio";

type CaptureSession = {
  process: ChildProcess;
  chunks: Buffer[];
  waiters: Array<() => void>;
  closed: boolean;
  error?: string;
};

const captures = new Map<string, CaptureSession>();
// ~10s of 16 kHz PCM16; older audio is dropped if nobody pulls.
const MAX_QUEUED_BYTES = 320_000;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readCommand(value: unknown, fallback: string[]): string[] {
  const argv = Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
    : [];
  return argv.length > 0 ? argv : fallback;
}

function wake(session: CaptureSession) {
  for (const waiter of session.waiters.splice(0)) {
    waiter();
  }
}

function closeCapture(session: CaptureSession, error?: string) {
  if (session.closed) {
    return;
  }
  session.closed = true;
  session.error ??= error;
  session.process.kill("SIGTERM");
  wake(session);
}

function startCapture(params: Record<string, unknown>) {
  const [command, ...args] = readCommand(
    params.inputCommand,
    DEFAULT_VOICE_AGENT_AUDIO_INPUT_COMMAND,
  );
  const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
  const session: CaptureSession = { process: child, chunks: [], waiters: [], closed: false };
  let stderr = "";
  child.stderr?.on("data", (chunk) => {
    stderr = `${stderr}${String(chunk)}`.slice(-2_000);
  });
  child.stdout?.on("data", (chunk: Buffer) => {
    session.chunks.push(chunk);
    let queued = session.chunks.reduce((sum, entry) => sum + entry.byteLength, 0);
    while (queued > MAX_QUEUED_BYTES && session.chunks.length > 1) {
      queued -= session.chunks.shift()?.byteLength ?? 0;
    }
    wake(session);
  });
  child.on("error", (error) => closeCapture(session, `${command}: ${error.message}`));
  child.on("exit", (code) =>
    closeCapture(session, code ? `${command} exited ${code}: ${stderr.trim()}` : undefined),
  );
  const captureId = `voiceagent_${randomUUID()}`;
  captures.set(captureId, session);
  return { captureId };
}

function requireCapture(params: Record<string, unknown>): [string, CaptureSession] {
  const captureId = readString(params.captureId);
  const session = captureId ? captures.get(captureId) : undefined;
  if (!captureId || !session) {
    throw new Error(`unknown captureId: ${captureId ?? "(missing)"}`);
  }
  return [captureId, session];
}

async function pullAudio(params: Record<string, unknown>) {
  const [, session] = requireCapture(params);
  if (session.chunks.length === 0 && !session.closed) {
    const timeoutMs = Math.min(Math.max(Number(params.timeoutMs) || 250, 10), 2_000);
    await Promise.race([
      sleep(timeoutMs),
      new Promise<void>((resolve) => session.waiters.push(resolve)),
    ]);
  }
  const audio = Buffer.concat(session.chunks.splice(0));
  return {
    closed: session.closed,
    ...(session.error ? { error: session.error } : {}),
    ...(audio.byteLength > 0 ? { base64: audio.toString("base64") } : {}),
  };
}

async function playAudio(params: Record<string, unknown>) {
  const base64 = readString(params.base64);
  const sampleRate = Number(params.sampleRate);
  if (!base64 || !Number.isInteger(sampleRate) || sampleRate <= 0) {
    throw new Error("base64 and sampleRate required");
  }
  const [command, ...args] = readCommand(
    params.outputCommand,
    DEFAULT_VOICE_AGENT_AUDIO_OUTPUT_COMMAND,
  ).map((part) => part.replaceAll("{sampleRate}", String(sampleRate)));
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["pipe", "ignore", "pipe"] });
    let stderr = "";
    child.stderr?.on("data", (chunk) => {
      stderr = `${stderr}${String(chunk)}`.slice(-2_000);
    });
    child.on("error", (error) => reject(new Error(`${command}: ${error.message}`)));
    child.on("exit", (code) =>
      code ? reject(new Error(`${command} exited ${code}: ${stderr.trim()}`)) : resolve(),
    );
    // EPIPE surfaces through `exit`/`error`; don't crash on it here.
    child.stdin?.on("error", () => {});
    child.stdin?.end(Buffer.from(base64, "base64"));
  });
  return { ok: true };
}

function stopCapture(params: Record<string, unknown>) {
  const captureId = readString(params.captureId);
  const session = captureId ? captures.get(captureId) : undefined;
  if (captureId && session) {
    closeCapture(session);
    captures.delete(captureId);
  }
  return { ok: true, stopped: Boolean(session) };
}

/** Single entry point shared by the gateway-local transport and the node-host command. */
export async function handleVoiceAgentAudioCommand(paramsJSON?: string | null): Promise<string> {
  const params = asRecord(paramsJSON ? JSON.parse(paramsJSON) : {});
  switch (readString(params.action)) {
    case "start":
      return JSON.stringify(startCapture(params));
    case "pull":
      return JSON.stringify(await pullAudio(params));
    case "play":
      return JSON.stringify(await playAudio(params));
    case "stop":
      return JSON.stringify(stopCapture(params));
    default:
      throw new Error(`unsupported ${VOICE_AGENT_NODE_COMMAND} action`);
  }
}
