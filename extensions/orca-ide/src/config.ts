import {
  buildPluginConfigSchema,
  formatPluginConfigIssue,
  mapPluginConfigIssues,
  z,
  type GenesisPluginConfigSchema,
} from "../runtime-api.js";

export type OrcaIdePluginConfig = {
  command?: string;
  environment?: string;
  pairingCode?: string;
  timeoutSeconds?: number;
  waitTimeoutSeconds?: number;
};

export type ResolvedOrcaIdeConfig = {
  command: string;
  environment?: string;
  pairingCode?: string;
  timeoutMs: number;
  waitTimeoutMs: number;
};

const DEFAULT_COMMAND = "orca";
const DEFAULT_TIMEOUT_SECONDS = 30;
const DEFAULT_WAIT_TIMEOUT_SECONDS = 300;

const nonEmptyTrimmedString = (message: string) =>
  z.string({ error: message }).trim().min(1, { error: message });

const OrcaIdePluginConfigSchema = z.strictObject({
  command: nonEmptyTrimmedString("command must be a non-empty string").optional(),
  environment: nonEmptyTrimmedString("environment must be a non-empty string").optional(),
  pairingCode: nonEmptyTrimmedString("pairingCode must be a non-empty string").optional(),
  timeoutSeconds: z
    .number({ error: "timeoutSeconds must be a number >= 1" })
    .min(1, { error: "timeoutSeconds must be a number >= 1" })
    .optional(),
  waitTimeoutSeconds: z
    .number({ error: "waitTimeoutSeconds must be a number >= 1" })
    .min(1, { error: "waitTimeoutSeconds must be a number >= 1" })
    .optional(),
});

export function createOrcaIdePluginConfigSchema(): GenesisPluginConfigSchema {
  return buildPluginConfigSchema(OrcaIdePluginConfigSchema, {
    safeParse(value) {
      if (value === undefined) {
        return { success: true, data: undefined };
      }
      const parsed = OrcaIdePluginConfigSchema.safeParse(value);
      if (parsed.success) {
        return { success: true, data: parsed.data };
      }
      return {
        success: false,
        error: { issues: mapPluginConfigIssues(parsed.error.issues) },
      };
    },
  });
}

export function resolveOrcaIdeConfig(value: unknown): ResolvedOrcaIdeConfig {
  if (value === undefined) {
    return {
      command: DEFAULT_COMMAND,
      environment: undefined,
      pairingCode: undefined,
      timeoutMs: DEFAULT_TIMEOUT_SECONDS * 1000,
      waitTimeoutMs: DEFAULT_WAIT_TIMEOUT_SECONDS * 1000,
    };
  }

  const parsed = OrcaIdePluginConfigSchema.safeParse(value);
  if (!parsed.success) {
    const message = formatPluginConfigIssue(parsed.error.issues[0]);
    throw new Error(`Invalid orca-ide plugin config: ${message}`);
  }
  const cfg = parsed.data as OrcaIdePluginConfig;
  return {
    command: cfg.command ?? DEFAULT_COMMAND,
    environment: cfg.environment,
    pairingCode: cfg.pairingCode,
    timeoutMs: Math.floor((cfg.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS) * 1000),
    waitTimeoutMs: Math.floor((cfg.waitTimeoutSeconds ?? DEFAULT_WAIT_TIMEOUT_SECONDS) * 1000),
  };
}
