import {
  ACPX_BACKEND_ID,
  AcpxRuntime as BaseAcpxRuntime,
  createAcpRuntime,
  createAgentRegistry,
  createFileSessionStore,
  decodeAcpxRuntimeHandleState,
  encodeAcpxRuntimeHandleState,
  type AcpAgentRegistry,
  type AcpRuntimeCapabilities,
  type AcpRuntimeDoctorReport,
  type AcpRuntimeEvent,
  type AcpRuntimeHandle,
  type AcpRuntimeOptions,
  type AcpRuntimeStatus,
} from "acpx/runtime";
import { AcpRuntimeError, type AcpRuntime } from "../runtime-api.js";
import type { AcpxPermissionMode } from "./config-schema.js";

type AcpSessionStore = AcpRuntimeOptions["sessionStore"];
type AcpSessionRecord = Parameters<AcpSessionStore["save"]>[0];
type AcpLoadedSessionRecord = Awaited<ReturnType<AcpSessionStore["load"]>>;

type ResetAwareSessionStore = AcpSessionStore & {
  markFresh: (sessionKey: string) => void;
};

function readSessionRecordName(record: AcpSessionRecord): string {
  if (typeof record !== "object" || record === null) {
    return "";
  }
  const { name } = record as { name?: unknown };
  return typeof name === "string" ? name.trim() : "";
}

function createResetAwareSessionStore(baseStore: AcpSessionStore): ResetAwareSessionStore {
  const freshSessionKeys = new Set<string>();

  return {
    async load(sessionId: string): Promise<AcpLoadedSessionRecord> {
      const normalized = sessionId.trim();
      if (normalized && freshSessionKeys.has(normalized)) {
        return undefined;
      }
      return await baseStore.load(sessionId);
    },
    async save(record: AcpSessionRecord): Promise<void> {
      await baseStore.save(record);
      const sessionName = readSessionRecordName(record);
      if (sessionName) {
        freshSessionKeys.delete(sessionName);
      }
    },
    markFresh(sessionKey: string): void {
      const normalized = sessionKey.trim();
      if (normalized) {
        freshSessionKeys.add(normalized);
      }
    },
  };
}

const GENESIS_BRIDGE_EXECUTABLE = "genesis";
const GENESIS_BRIDGE_SUBCOMMAND = "acp";

function normalizeAgentName(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized ? normalized : undefined;
}

function readAgentFromSessionKey(sessionKey: string | undefined): string | undefined {
  const normalized = sessionKey?.trim();
  if (!normalized) {
    return undefined;
  }
  const match = /^agent:(?<agent>[^:]+):/i.exec(normalized);
  return normalizeAgentName(match?.groups?.agent);
}

function readAgentFromHandle(handle: AcpRuntimeHandle): string | undefined {
  const decoded = decodeAcpxRuntimeHandleState(handle.runtimeSessionName);
  if (typeof decoded === "object" && decoded !== null) {
    const { agent } = decoded as { agent?: unknown };
    if (typeof agent === "string") {
      return normalizeAgentName(agent) ?? readAgentFromSessionKey(handle.sessionKey);
    }
  }
  return readAgentFromSessionKey(handle.sessionKey);
}

function readAgentCommandFromRecord(record: AcpLoadedSessionRecord): string | undefined {
  if (typeof record !== "object" || record === null) {
    return undefined;
  }
  const { agentCommand } = record as { agentCommand?: unknown };
  return typeof agentCommand === "string" ? agentCommand.trim() || undefined : undefined;
}

function splitCommandParts(value: string): string[] {
  const parts: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let escaping = false;

  for (const ch of value) {
    if (escaping) {
      current += ch;
      escaping = false;
      continue;
    }
    if (ch === "\\" && quote !== "'") {
      escaping = true;
      continue;
    }
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        current += ch;
      }
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (current) {
        parts.push(current);
        current = "";
      }
      continue;
    }
    current += ch;
  }

  if (escaping) {
    current += "\\";
  }
  if (current) {
    parts.push(current);
  }
  return parts;
}

function basename(value: string): string {
  return value.split(/[\\/]/).pop() ?? value;
}

function isEnvAssignment(value: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*=/.test(value);
}

function unwrapEnvCommand(parts: string[]): string[] {
  if (!parts.length || basename(parts[0]) !== "env") {
    return parts;
  }
  let index = 1;
  while (index < parts.length && isEnvAssignment(parts[index])) {
    index += 1;
  }
  return parts.slice(index);
}

function isGenesisBridgeCommand(command: string | undefined): boolean {
  if (!command) {
    return false;
  }
  const parts = unwrapEnvCommand(splitCommandParts(command.trim()));
  if (basename(parts[0] ?? "") === GENESIS_BRIDGE_EXECUTABLE) {
    return parts[1] === GENESIS_BRIDGE_SUBCOMMAND;
  }
  if (basename(parts[0] ?? "") !== "node") {
    return false;
  }
  const scriptName = basename(parts[1] ?? "");
  return /^genesis(?:\.[cm]?js)?$/i.test(scriptName) && parts[2] === GENESIS_BRIDGE_SUBCOMMAND;
}

function resolveAgentCommand(params: {
  agentName: string | undefined;
  agentRegistry: AcpAgentRegistry;
}): string | undefined {
  const normalizedAgentName = normalizeAgentName(params.agentName);
  if (!normalizedAgentName) {
    return undefined;
  }
  const resolvedCommand = params.agentRegistry.resolve(normalizedAgentName);
  return typeof resolvedCommand === "string" ? resolvedCommand.trim() || undefined : undefined;
}

function resolveProbeAgentName(options: AcpRuntimeOptions): string {
  const { probeAgent } = options as { probeAgent?: unknown };
  return normalizeAgentName(typeof probeAgent === "string" ? probeAgent : undefined) ?? "codex";
}

function resolveAgentCommandForName(params: {
  agentName: string | undefined;
  agentRegistry: AcpAgentRegistry;
}): string | undefined {
  return resolveAgentCommand(params);
}

function shouldUseBridgeSafeDelegateForCommand(command: string | undefined): boolean {
  return isGenesisBridgeCommand(command);
}

function shouldUseDistinctBridgeDelegate(options: AcpRuntimeOptions): boolean {
  const { mcpServers } = options as { mcpServers?: unknown };
  return Array.isArray(mcpServers) && mcpServers.length > 0;
}

type AcpxDelegates = {
  delegate: BaseAcpxRuntime;
  bridgeSafeDelegate: BaseAcpxRuntime;
};

function createAcpxDelegates(
  options: AcpRuntimeOptions,
  testOptions: ConstructorParameters<typeof BaseAcpxRuntime>[1],
): AcpxDelegates {
  const delegate = new BaseAcpxRuntime(options, testOptions);
  return {
    delegate,
    bridgeSafeDelegate: shouldUseDistinctBridgeDelegate(options)
      ? new BaseAcpxRuntime({ ...options, mcpServers: [] }, testOptions)
      : delegate,
  };
}

// Least to most permissive, matching acpx's own permission rank.
const ACPX_PERMISSION_MODE_ORDER: readonly AcpxPermissionMode[] = [
  "deny-all",
  "approve-reads",
  "approve-all",
];

export class AcpxRuntime implements AcpRuntime {
  private readonly sessionStore: ResetAwareSessionStore;
  private readonly agentRegistry: AcpAgentRegistry;
  private readonly delegate: BaseAcpxRuntime;
  private readonly bridgeSafeDelegate: BaseAcpxRuntime;
  private readonly probeDelegate: BaseAcpxRuntime;
  private readonly permissionMode: string | undefined;
  private readonly allowSpawnPermissionEscalation: boolean;
  private readonly sharedOptions: AcpRuntimeOptions;
  private readonly testOptions: ConstructorParameters<typeof BaseAcpxRuntime>[1];
  // acpx only takes permissionMode at construction, so each mode gets its own delegates.
  private readonly delegatesByPermissionMode = new Map<string | undefined, AcpxDelegates>();
  private readonly permissionModeBySessionKey = new Map<string, AcpxPermissionMode>();

  constructor(
    options: AcpRuntimeOptions & { allowSpawnPermissionEscalation?: boolean },
    testOptions?: ConstructorParameters<typeof BaseAcpxRuntime>[1],
  ) {
    const { allowSpawnPermissionEscalation, ...runtimeOptions } = options;
    this.sessionStore = createResetAwareSessionStore(runtimeOptions.sessionStore);
    this.agentRegistry = runtimeOptions.agentRegistry;
    this.permissionMode =
      typeof runtimeOptions.permissionMode === "string" ? runtimeOptions.permissionMode : undefined;
    this.allowSpawnPermissionEscalation = allowSpawnPermissionEscalation === true;
    this.sharedOptions = {
      ...runtimeOptions,
      sessionStore: this.sessionStore,
    };
    this.testOptions = testOptions;
    const defaults = createAcpxDelegates(this.sharedOptions, testOptions);
    this.delegatesByPermissionMode.set(this.permissionMode, defaults);
    this.delegate = defaults.delegate;
    this.bridgeSafeDelegate = defaults.bridgeSafeDelegate;
    this.probeDelegate = this.resolveDelegateForAgent(resolveProbeAgentName(options), defaults);
  }

  private resolveSessionPermissionMode(sessionKey: string): string | undefined {
    return this.permissionModeBySessionKey.get(sessionKey) ?? this.permissionMode;
  }

  private delegatesForSession(sessionKey: string): AcpxDelegates {
    const permissionMode = this.resolveSessionPermissionMode(sessionKey);
    let delegates = this.delegatesByPermissionMode.get(permissionMode);
    if (!delegates) {
      delegates = createAcpxDelegates({ ...this.sharedOptions, permissionMode }, this.testOptions);
      this.delegatesByPermissionMode.set(permissionMode, delegates);
    }
    return delegates;
  }

  private validateSpawnPermissionMode(requested: string): AcpxPermissionMode {
    const requestedRank = ACPX_PERMISSION_MODE_ORDER.indexOf(requested as AcpxPermissionMode);
    if (requestedRank < 0) {
      throw new AcpRuntimeError(
        "ACP_INVALID_RUNTIME_OPTION",
        `Unsupported acpx permissionMode "${requested}"; expected one of: ${ACPX_PERMISSION_MODE_ORDER.join(", ")}.`,
      );
    }
    const configuredRank = ACPX_PERMISSION_MODE_ORDER.indexOf(
      this.permissionMode as AcpxPermissionMode,
    );
    if (requestedRank > configuredRank && !this.allowSpawnPermissionEscalation) {
      throw new AcpRuntimeError(
        "ACP_INVALID_RUNTIME_OPTION",
        `permissionMode "${requested}" is more permissive than the configured acpx permissionMode "${this.permissionMode}". ` +
          "An operator must set plugins.entries.acpx.config.allowSpawnPermissionEscalation=true to allow per-spawn escalation.",
      );
    }
    return requested as AcpxPermissionMode;
  }

  private resolveDelegateForAgent(
    agentName: string | undefined,
    delegates: AcpxDelegates,
  ): BaseAcpxRuntime {
    const command = resolveAgentCommandForName({
      agentName,
      agentRegistry: this.agentRegistry,
    });
    return this.resolveDelegateForCommand(command, delegates);
  }

  private resolveDelegateForCommand(
    command: string | undefined,
    delegates: AcpxDelegates,
  ): BaseAcpxRuntime {
    return shouldUseBridgeSafeDelegateForCommand(command)
      ? delegates.bridgeSafeDelegate
      : delegates.delegate;
  }

  private async resolveDelegateForHandle(handle: AcpRuntimeHandle): Promise<BaseAcpxRuntime> {
    const delegates = this.delegatesForSession(handle.sessionKey);
    const record = await this.sessionStore.load(handle.acpxRecordId ?? handle.sessionKey);
    const recordCommand = readAgentCommandFromRecord(record);
    if (recordCommand) {
      return this.resolveDelegateForCommand(recordCommand, delegates);
    }
    return this.resolveDelegateForAgent(readAgentFromHandle(handle), delegates);
  }

  isHealthy(): boolean {
    return this.probeDelegate.isHealthy();
  }

  probeAvailability(): Promise<void> {
    return this.probeDelegate.probeAvailability();
  }

  doctor(): Promise<AcpRuntimeDoctorReport> {
    return this.probeDelegate.doctor();
  }

  async ensureSession(
    input: Parameters<AcpRuntime["ensureSession"]>[0],
  ): Promise<AcpRuntimeHandle> {
    this.permissionModeBySessionKey.delete(input.sessionKey);
    if (input.permissionMode) {
      this.permissionModeBySessionKey.set(
        input.sessionKey,
        this.validateSpawnPermissionMode(input.permissionMode),
      );
    }
    const delegates = this.delegatesForSession(input.sessionKey);
    return await this.resolveDelegateForAgent(input.agent, delegates).ensureSession(input);
  }

  async *runTurn(input: Parameters<AcpRuntime["runTurn"]>[0]): AsyncIterable<AcpRuntimeEvent> {
    yield* (await this.resolveDelegateForHandle(input.handle)).runTurn(input);
  }

  async getCapabilities(input?: { handle?: AcpRuntimeHandle }): Promise<AcpRuntimeCapabilities> {
    const capabilities = await this.delegate.getCapabilities();
    const permissionMode = input?.handle
      ? this.resolveSessionPermissionMode(input.handle.sessionKey)
      : this.permissionMode;
    return permissionMode ? { ...capabilities, permissionMode } : capabilities;
  }

  async getStatus(
    input: Parameters<NonNullable<AcpRuntime["getStatus"]>>[0],
  ): Promise<AcpRuntimeStatus> {
    const delegate = await this.resolveDelegateForHandle(input.handle);
    return delegate.getStatus(input);
  }

  async setMode(input: Parameters<NonNullable<AcpRuntime["setMode"]>>[0]): Promise<void> {
    const delegate = await this.resolveDelegateForHandle(input.handle);
    await delegate.setMode(input);
  }

  async setConfigOption(
    input: Parameters<NonNullable<AcpRuntime["setConfigOption"]>>[0],
  ): Promise<void> {
    const delegate = await this.resolveDelegateForHandle(input.handle);
    await delegate.setConfigOption(input);
  }

  async cancel(input: Parameters<AcpRuntime["cancel"]>[0]): Promise<void> {
    const delegate = await this.resolveDelegateForHandle(input.handle);
    await delegate.cancel(input);
  }

  async prepareFreshSession(input: { sessionKey: string }): Promise<void> {
    this.sessionStore.markFresh(input.sessionKey);
  }

  async close(input: Parameters<AcpRuntime["close"]>[0]): Promise<void> {
    await (
      await this.resolveDelegateForHandle(input.handle)
    ).close({
      handle: input.handle,
      reason: input.reason,
      discardPersistentState: input.discardPersistentState,
    });
    // A reopened session is re-ensured with its persisted mode, so drop the entry
    // instead of keeping one per spawn for the gateway's lifetime.
    this.permissionModeBySessionKey.delete(input.handle.sessionKey);
    if (input.discardPersistentState) {
      this.sessionStore.markFresh(input.handle.sessionKey);
    }
  }
}

export {
  ACPX_BACKEND_ID,
  createAcpRuntime,
  createAgentRegistry,
  createFileSessionStore,
  decodeAcpxRuntimeHandleState,
  encodeAcpxRuntimeHandleState,
};

export type { AcpAgentRegistry, AcpRuntimeOptions, AcpSessionRecord, AcpSessionStore };
