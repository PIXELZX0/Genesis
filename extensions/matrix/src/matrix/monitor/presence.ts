import type { IPresenceOpts } from "matrix-js-sdk";
import type { CoreConfig, MatrixPresenceState } from "../../types.js";
import type { MatrixClient } from "../sdk.js";

const MATRIX_PRESENCE_STATES: ReadonlySet<MatrixPresenceState> = new Set([
  "online",
  "unavailable",
  "offline",
]);

const DEFAULT_PRESENCE_STATE: MatrixPresenceState = "online";

export type MatrixMonitorPresenceLog = {
  info: (message: string, meta?: Record<string, unknown>) => void;
  warn: (message: string, meta?: Record<string, unknown>) => void;
  debug?: (message: string, meta?: Record<string, unknown>) => void;
};

function normalizeOptionalText(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizePresenceState(value: unknown): MatrixPresenceState {
  if (typeof value !== "string") {
    return DEFAULT_PRESENCE_STATE;
  }
  const lowered = value.toLowerCase();
  if (MATRIX_PRESENCE_STATES.has(lowered as MatrixPresenceState)) {
    return lowered as MatrixPresenceState;
  }
  throw new Error(
    `matrix: invalid presence state "${value}" (expected one of: online, unavailable, offline)`,
  );
}

export function resolveMatrixPresenceConfig(cfg: CoreConfig | undefined): IPresenceOpts {
  const presence = cfg?.channels?.matrix?.presence;
  const state = normalizePresenceState(presence?.state);
  const statusMessage = normalizeOptionalText(presence?.statusMessage);
  return state === "online" && statusMessage
    ? { presence: state, status_msg: statusMessage }
    : { presence: state };
}

type PresenceCapableClient = Pick<MatrixClient, "setPresence">;

export type ApplyMatrixPresenceResult =
  | { applied: true; state: MatrixPresenceState; statusMessage?: string }
  | { applied: false; reason: "aborted" | "no-op" };

export async function applyMatrixPresence(params: {
  client: PresenceCapableClient;
  cfg: CoreConfig | undefined;
  log: MatrixMonitorPresenceLog;
  abortSignal?: AbortSignal;
}): Promise<ApplyMatrixPresenceResult> {
  if (params.abortSignal?.aborted) {
    params.log.debug?.("matrix: skipping presence publish (aborted before ready)");
    return { applied: false, reason: "aborted" };
  }
  const opts = resolveMatrixPresenceConfig(params.cfg);
  try {
    await params.client.setPresence(opts);
    const hasStatusMsg = "status_msg" in opts && typeof opts.status_msg === "string";
    params.log.info(
      `matrix: published presence state=${opts.presence}${
        hasStatusMsg ? ` status_msg=${JSON.stringify(opts.status_msg)}` : ""
      }`,
    );
    return {
      applied: true,
      state: opts.presence,
      ...(hasStatusMsg ? { statusMessage: opts.status_msg as string } : {}),
    };
  } catch (err) {
    params.log.warn("matrix: failed to publish presence (non-fatal)", {
      error: String(err),
    });
    return { applied: false, reason: "no-op" };
  }
}
