import crypto from "node:crypto";
import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import JSON5 from "json5";
import YAML from "yaml";
import { resolveGenesisAgentDir } from "../agents/agent-paths.js";
import {
  ensureAuthProfileStoreForLocalUpdate,
  saveAuthProfileStore,
} from "../agents/auth-profiles/store.js";
import type { AuthProfileCredential } from "../agents/auth-profiles/types.js";
import { normalizeProviderId } from "../agents/provider-id.js";
import { readConfigFileSnapshot, replaceConfigFile } from "../config/config.js";
import { resolveConfigPath, resolveStateDir } from "../config/paths.js";
import type { GenesisConfig } from "../config/types.genesis.js";
import type {
  ModelApi,
  ModelDefinitionConfig,
  ModelProviderConfig,
} from "../config/types.models.js";
import {
  DEFAULT_SECRET_PROVIDER_ALIAS,
  isValidEnvSecretRefId,
  type SecretInput,
} from "../config/types.secrets.js";
import { formatErrorMessage } from "../infra/errors.js";
import { loadJsonFile } from "../infra/json-file.js";
import { applyAuthProfileConfig } from "../plugins/provider-auth-helpers.js";
import type { RuntimeEnv } from "../runtime.js";
import { writeRuntimeJson } from "../runtime.js";
import { isRecord, resolveUserPath } from "../utils.js";

export type MigrationSource = "openclaw" | "hermes";

export type MigrateCommandOptions = {
  sourceDir?: string;
  sourceConfig?: string;
  dryRun?: boolean;
  force?: boolean;
  json?: boolean;
};

export type MigrationChange = {
  action: "write" | "copy" | "merge" | "skip";
  target: string;
  detail: string;
};

export type MigrationResult = {
  source: MigrationSource;
  dryRun: boolean;
  sourceDir: string;
  targetStateDir: string;
  targetConfigPath: string;
  changes: MigrationChange[];
  warnings: string[];
};

type MigrationPlan = MigrationResult & {
  nextConfig?: GenesisConfig;
  envMerge?: DotEnvMergePlan;
  copies: CopyPlanEntry[];
  authProfiles: AuthProfilePlanEntry[];
};

type CopyPlanEntry = {
  sourcePath: string;
  targetPath: string;
  kind: "file" | "directory";
  description: string;
};

type DotEnvMergePlan = {
  sourcePath: string;
  targetPath: string;
  entries: Record<string, string>;
};

type AuthProfilePlanEntry = {
  profileId: string;
  credential: AuthProfileCredential;
  displayName?: string;
};

type HermesModelRef = {
  provider: string;
  model: string;
};

type HermesProviderImport = {
  providerId: string;
  baseUrl: string;
  apiKey?: SecretInput;
  models: string[];
};

const OPENCLAW_STATE_DIRNAME = ".openclaw";
const OPENCLAW_LEGACY_STATE_DIRNAME = ".clawdbot";
const OPENCLAW_CONFIG_FILENAMES = ["openclaw.json", "clawdbot.json"] as const;
const HERMES_STATE_DIRNAME = ".hermes";
const HERMES_CONFIG_FILENAME = "config.yaml";
const DEFAULT_CONTEXT_WINDOW = 128_000;
const DEFAULT_MAX_TOKENS = 8192;

function resolveHomeDir(): string {
  return os.homedir();
}

function resolveOptionalUserPath(input: string | undefined): string | undefined {
  return input ? resolveUserPath(input) : undefined;
}

async function pathExists(pathname: string): Promise<boolean> {
  try {
    await fs.access(pathname);
    return true;
  } catch {
    return false;
  }
}

async function statKind(pathname: string): Promise<"file" | "directory" | null> {
  try {
    const stat = await fs.lstat(pathname);
    if (stat.isDirectory()) {
      return "directory";
    }
    return "file";
  } catch {
    return null;
  }
}

function cloneConfig(config: GenesisConfig): GenesisConfig {
  return structuredClone(config);
}

function normalizeText(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function sanitizeId(value: string, fallback: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || fallback;
}

function mergeValues(target: unknown, incoming: unknown, force: boolean): unknown {
  if (incoming === undefined) {
    return target;
  }
  if (target === undefined || force) {
    return structuredClone(incoming);
  }
  if (isRecord(target) && isRecord(incoming)) {
    const merged: Record<string, unknown> = { ...target };
    for (const [key, value] of Object.entries(incoming)) {
      merged[key] = mergeValues(merged[key], value, force);
    }
    return merged;
  }
  return target;
}

export function mergeConfigPreservingTarget(
  target: GenesisConfig,
  incoming: GenesisConfig,
  force: boolean,
): GenesisConfig {
  return mergeValues(target, incoming, force) as GenesisConfig;
}

function transformOpenClawString(
  value: string,
  params: { sourceDir: string; targetDir: string },
): string {
  let next = value;
  next = next.replaceAll("OPENCLAW_", "GENESIS_");
  next = next.replaceAll("~/.openclaw", "~/.genesis");
  next = next.replaceAll("~/.clawdbot", "~/.genesis");
  next = next.replaceAll(path.resolve(params.sourceDir), path.resolve(params.targetDir));
  return next;
}

function transformOpenClawKey(key: string): string {
  return key.replaceAll("OPENCLAW_", "GENESIS_");
}

export function transformOpenClawConfig(
  config: unknown,
  params: { sourceDir: string; targetDir: string },
): GenesisConfig {
  function visit(value: unknown): unknown {
    if (typeof value === "string") {
      return transformOpenClawString(value, params);
    }
    if (Array.isArray(value)) {
      return value.map((entry) => visit(entry));
    }
    if (!isRecord(value)) {
      return value;
    }
    const next: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      next[transformOpenClawKey(key)] = visit(child);
    }
    return next;
  }
  return visit(config) as GenesisConfig;
}

function parseJson5Config(raw: string, label: string): unknown {
  try {
    return JSON5.parse(raw) as unknown;
  } catch (err) {
    throw new Error(`${label}: failed to parse JSON5: ${formatErrorMessage(err)}`, {
      cause: err,
    });
  }
}

function parseYamlConfig(raw: string, label: string): unknown {
  try {
    return YAML.parse(raw, { schema: "core" }) as unknown;
  } catch (err) {
    throw new Error(`${label}: failed to parse YAML: ${formatErrorMessage(err)}`, {
      cause: err,
    });
  }
}

async function readConfigObject(pathname: string, kind: "json5" | "yaml"): Promise<unknown> {
  const raw = await fs.readFile(pathname, "utf8");
  return kind === "json5" ? parseJson5Config(raw, pathname) : parseYamlConfig(raw, pathname);
}

function resolveDefaultOpenClawStateDir(): string {
  const override = process.env.OPENCLAW_STATE_DIR?.trim();
  if (override) {
    return resolveUserPath(override);
  }
  return path.join(resolveHomeDir(), OPENCLAW_STATE_DIRNAME);
}

async function resolveOpenClawSourceDir(input?: string): Promise<string> {
  if (input) {
    return resolveUserPath(input);
  }
  const primary = resolveDefaultOpenClawStateDir();
  if (await pathExists(primary)) {
    return primary;
  }
  const legacy = path.join(resolveHomeDir(), OPENCLAW_LEGACY_STATE_DIRNAME);
  return legacy;
}

async function resolveOpenClawConfigPath(sourceDir: string, input?: string): Promise<string> {
  const explicit =
    resolveOptionalUserPath(input) ?? resolveOptionalUserPath(process.env.OPENCLAW_CONFIG_PATH);
  if (explicit) {
    return explicit;
  }
  for (const filename of OPENCLAW_CONFIG_FILENAMES) {
    const candidate = path.join(sourceDir, filename);
    if (await pathExists(candidate)) {
      return candidate;
    }
  }
  return path.join(sourceDir, OPENCLAW_CONFIG_FILENAMES[0]);
}

function resolveHermesSourceDir(input?: string): string {
  if (input) {
    return resolveUserPath(input);
  }
  const override = process.env.HERMES_HOME?.trim();
  if (override) {
    return resolveUserPath(override);
  }
  return path.join(resolveHomeDir(), HERMES_STATE_DIRNAME);
}

function resolveHermesConfigPath(sourceDir: string, input?: string): string {
  return resolveOptionalUserPath(input) ?? path.join(sourceDir, HERMES_CONFIG_FILENAME);
}

function parseDotEnv(raw: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) {
      continue;
    }
    result[match[1]] = unquoteDotEnvValue(match[2].trim());
  }
  return result;
}

function unquoteDotEnvValue(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function quoteDotEnvValue(value: string): string {
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(value)) {
    return value;
  }
  return JSON.stringify(value);
}

export function mergeDotEnvRaw(params: {
  targetRaw: string;
  entries: Record<string, string>;
  force?: boolean;
}): { raw: string; added: string[]; replaced: string[]; skipped: string[] } {
  const force = params.force === true;
  const lines = params.targetRaw ? params.targetRaw.replace(/\r?\n$/u, "").split(/\r?\n/) : [];
  const existingKeys = new Set<string>();
  const replaced: string[] = [];
  const skipped: string[] = [];
  const added: string[] = [];
  const nextLines = lines.map((line) => {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
    if (!match) {
      return line;
    }
    const key = match[1];
    existingKeys.add(key);
    if (!Object.prototype.hasOwnProperty.call(params.entries, key)) {
      return line;
    }
    if (!force) {
      skipped.push(key);
      return line;
    }
    replaced.push(key);
    return `${key}=${quoteDotEnvValue(params.entries[key] ?? "")}`;
  });

  for (const [key, value] of Object.entries(params.entries).toSorted(([left], [right]) =>
    left.localeCompare(right),
  )) {
    if (existingKeys.has(key)) {
      continue;
    }
    added.push(key);
    nextLines.push(`${key}=${quoteDotEnvValue(value)}`);
  }

  let raw = nextLines.join("\n");
  raw = raw.replace(/\n+$/u, "");
  if (raw.length > 0) {
    raw += "\n";
  }
  return { raw, added, replaced, skipped };
}

async function buildDotEnvMergePlan(params: {
  sourcePath: string;
  targetPath: string;
  transform?: (entries: Record<string, string>) => Record<string, string>;
}): Promise<DotEnvMergePlan | undefined> {
  if (!(await pathExists(params.sourcePath))) {
    return undefined;
  }
  const sourceRaw = await fs.readFile(params.sourcePath, "utf8");
  const parsed = parseDotEnv(sourceRaw);
  const entries = params.transform ? params.transform(parsed) : parsed;
  if (Object.keys(entries).length === 0) {
    return undefined;
  }
  return {
    sourcePath: params.sourcePath,
    targetPath: params.targetPath,
    entries,
  };
}

function transformOpenClawEnvEntries(
  entries: Record<string, string>,
  params: { sourceDir: string; targetDir: string },
): Record<string, string> {
  const next: Record<string, string> = {};
  for (const [key, value] of Object.entries(entries)) {
    const targetKey = key.startsWith("OPENCLAW_") ? key.replace(/^OPENCLAW_/u, "GENESIS_") : key;
    next[targetKey] = transformOpenClawString(value, params);
  }
  return next;
}

function buildCopyChange(entry: CopyPlanEntry): MigrationChange {
  return {
    action: "copy",
    target: entry.targetPath,
    detail: `${entry.description} from ${entry.sourcePath}`,
  };
}

async function planCopy(
  changes: MigrationChange[],
  warnings: string[],
  entry: CopyPlanEntry,
  force: boolean,
): Promise<CopyPlanEntry | null> {
  const sourceKind = await statKind(entry.sourcePath);
  if (!sourceKind) {
    return null;
  }
  if (sourceKind !== entry.kind && entry.kind === "directory") {
    warnings.push(`Skipped ${entry.sourcePath}: expected a directory.`);
    return null;
  }
  const targetExists = await pathExists(entry.targetPath);
  if (targetExists && !force) {
    changes.push({
      action: "skip",
      target: entry.targetPath,
      detail: `${entry.description} already exists; use --force to overwrite.`,
    });
    return null;
  }
  changes.push(buildCopyChange(entry));
  return entry;
}

async function collectDirectoryChildCopies(params: {
  sourceDir: string;
  targetDir: string;
  description: string;
  changes: MigrationChange[];
  warnings: string[];
  force: boolean;
}): Promise<CopyPlanEntry[]> {
  if (!(await pathExists(params.sourceDir))) {
    return [];
  }
  const entries = await fs.readdir(params.sourceDir, { withFileTypes: true });
  const copies: CopyPlanEntry[] = [];
  for (const entry of entries.toSorted((left, right) => left.name.localeCompare(right.name))) {
    const kind = entry.isDirectory() ? "directory" : "file";
    const planned = await planCopy(
      params.changes,
      params.warnings,
      {
        sourcePath: path.join(params.sourceDir, entry.name),
        targetPath: path.join(params.targetDir, entry.name),
        kind,
        description: `${params.description} ${entry.name}`,
      },
      params.force,
    );
    if (planned) {
      copies.push(planned);
    }
  }
  return copies;
}

async function buildOpenClawPlan(opts: MigrateCommandOptions): Promise<MigrationPlan> {
  const sourceDir = await resolveOpenClawSourceDir(opts.sourceDir);
  const sourceConfigPath = await resolveOpenClawConfigPath(sourceDir, opts.sourceConfig);
  if (!(await pathExists(sourceDir))) {
    throw new Error(`OpenClaw state directory not found: ${sourceDir}`);
  }
  if (!(await pathExists(sourceConfigPath))) {
    throw new Error(`OpenClaw config file not found: ${sourceConfigPath}`);
  }

  const targetStateDir = resolveStateDir();
  const targetConfigPath = resolveConfigPath(process.env, targetStateDir);
  const sourceConfig = await readConfigObject(sourceConfigPath, "json5");
  const transformed = transformOpenClawConfig(sourceConfig, {
    sourceDir,
    targetDir: targetStateDir,
  });
  const targetSnapshot = await readConfigFileSnapshot();
  const baseConfig = targetSnapshot.sourceConfig ?? {};
  const nextConfig = mergeConfigPreservingTarget(baseConfig, transformed, opts.force === true);
  const changes: MigrationChange[] = [
    {
      action: "merge",
      target: targetConfigPath,
      detail: opts.force
        ? `Replace matching Genesis config fields from ${sourceConfigPath}.`
        : `Import missing Genesis config fields from ${sourceConfigPath}.`,
    },
  ];
  const warnings = [
    "Stop any running OpenClaw and Genesis gateways before using the migrated state.",
  ];

  const copies: CopyPlanEntry[] = [];
  const children = await fs.readdir(sourceDir, { withFileTypes: true });
  for (const entry of children.toSorted((left, right) => left.name.localeCompare(right.name))) {
    if (
      OPENCLAW_CONFIG_FILENAMES.includes(entry.name as (typeof OPENCLAW_CONFIG_FILENAMES)[number])
    ) {
      continue;
    }
    if (entry.name === ".env") {
      continue;
    }
    const kind = entry.isDirectory() ? "directory" : "file";
    const planned = await planCopy(
      changes,
      warnings,
      {
        sourcePath: path.join(sourceDir, entry.name),
        targetPath: path.join(targetStateDir, entry.name),
        kind,
        description: `OpenClaw ${entry.name}`,
      },
      opts.force === true,
    );
    if (planned) {
      copies.push(planned);
    }
  }

  const envMerge = await buildDotEnvMergePlan({
    sourcePath: path.join(sourceDir, ".env"),
    targetPath: path.join(targetStateDir, ".env"),
    transform: (entries) =>
      transformOpenClawEnvEntries(entries, { sourceDir, targetDir: targetStateDir }),
  });
  if (envMerge) {
    changes.push({
      action: "merge",
      target: envMerge.targetPath,
      detail: `Import ${Object.keys(envMerge.entries).length} OpenClaw environment variable(s).`,
    });
  }

  return {
    source: "openclaw",
    dryRun: opts.dryRun === true,
    sourceDir,
    targetStateDir,
    targetConfigPath,
    changes,
    warnings,
    nextConfig,
    envMerge,
    copies,
    authProfiles: [],
  };
}

function normalizeHermesProvider(provider: string): string {
  const raw = provider.trim().toLowerCase();
  if (!raw) {
    return "";
  }
  if (raw === "gemini" || raw === "google-ai-studio" || raw === "google-gemini") {
    return "google";
  }
  if (raw.startsWith("custom:")) {
    return `hermes-${sanitizeId(raw.slice("custom:".length), "custom")}`;
  }
  if (raw === "custom") {
    return "hermes-custom";
  }
  return normalizeProviderId(raw);
}

function parseHermesModelRef(value: unknown, defaultProvider?: string): HermesModelRef | null {
  if (typeof value === "string") {
    const raw = value.trim();
    if (!raw) {
      return null;
    }
    const provider = normalizeHermesProvider(defaultProvider ?? raw.split("/")[0] ?? "");
    if (!provider) {
      return null;
    }
    if (raw.includes("/")) {
      return { provider, model: raw.split("/").slice(1).join("/") };
    }
    return defaultProvider ? { provider, model: raw } : null;
  }
  if (!isRecord(value)) {
    return null;
  }
  const providerRaw = normalizeText(value.provider);
  const model =
    normalizeText(value.model) ??
    normalizeText(value.default) ??
    normalizeText(value.default_model) ??
    normalizeText(value.id);
  if (!providerRaw || !model || providerRaw === "auto") {
    return null;
  }
  return {
    provider: normalizeHermesProvider(providerRaw),
    model,
  };
}

function formatModelRef(ref: HermesModelRef): string {
  return `${ref.provider}/${ref.model}`;
}

function normalizeHermesFallbackModels(value: unknown): HermesModelRef[] {
  if (!value) {
    return [];
  }
  const values = Array.isArray(value) ? value : [value];
  return values
    .map((entry) => parseHermesModelRef(entry))
    .filter((entry): entry is HermesModelRef => entry !== null);
}

function createImportedModelDefinition(
  modelId: string,
  api: ModelApi = "openai-completions",
): ModelDefinitionConfig {
  return {
    id: modelId,
    name: modelId,
    api,
    reasoning: false,
    input: ["text"],
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
    },
    contextWindow: DEFAULT_CONTEXT_WINDOW,
    maxTokens: DEFAULT_MAX_TOKENS,
    metadataSource: "models-add",
  };
}

function mergeAgentModelDefaults(
  config: GenesisConfig,
  primary: HermesModelRef | null,
  fallbacks: HermesModelRef[],
  force: boolean,
): GenesisConfig {
  if (!primary && fallbacks.length === 0) {
    return config;
  }
  const next = cloneConfig(config);
  next.agents = { ...next.agents };
  next.agents.defaults = { ...next.agents.defaults };
  const model = primary
    ? {
        primary: formatModelRef(primary),
        ...(fallbacks.length > 0 ? { fallbacks: fallbacks.map(formatModelRef) } : {}),
      }
    : fallbacks.length > 0
      ? { fallbacks: fallbacks.map(formatModelRef) }
      : undefined;
  if (model && (force || next.agents.defaults.model === undefined)) {
    next.agents.defaults.model = model;
  }
  next.agents.defaults.models = {
    ...Object.fromEntries(
      [primary, ...fallbacks]
        .filter((entry): entry is HermesModelRef => entry !== null)
        .map((entry) => [formatModelRef(entry), {}]),
    ),
    ...next.agents.defaults.models,
  };
  if (force) {
    next.agents.defaults.models = {
      ...next.agents.defaults.models,
      ...Object.fromEntries(
        [primary, ...fallbacks]
          .filter((entry): entry is HermesModelRef => entry !== null)
          .map((entry) => [formatModelRef(entry), {}]),
      ),
    };
  }
  return next;
}

function collectStringList(value: unknown): string[] {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map(normalizeText).filter((entry): entry is string => entry !== undefined);
}

function resolveHermesSecretInput(value: unknown): SecretInput | undefined {
  const text = normalizeText(value);
  if (!text) {
    return undefined;
  }
  if (isValidEnvSecretRefId(text)) {
    return { source: "env", provider: DEFAULT_SECRET_PROVIDER_ALIAS, id: text };
  }
  if (/^\$\{[A-Z][A-Z0-9_]*\}$/u.test(text)) {
    const id = text.slice(2, -1);
    return { source: "env", provider: DEFAULT_SECRET_PROVIDER_ALIAS, id };
  }
  return text;
}

function collectHermesProviderImports(config: unknown): HermesProviderImport[] {
  if (!isRecord(config)) {
    return [];
  }
  const rawProviders = config.providers;
  if (!isRecord(rawProviders)) {
    return [];
  }
  const imports: HermesProviderImport[] = [];
  for (const [rawName, rawConfig] of Object.entries(rawProviders)) {
    if (!isRecord(rawConfig)) {
      continue;
    }
    const providerId = normalizeHermesProvider(rawName);
    const baseUrl =
      normalizeText(rawConfig.base_url) ??
      normalizeText(rawConfig.baseUrl) ??
      normalizeText(rawConfig.api_base_url) ??
      normalizeText(rawConfig.url);
    if (!providerId || !baseUrl) {
      continue;
    }
    const apiKey =
      resolveHermesSecretInput(rawConfig.api_key_env) ??
      resolveHermesSecretInput(rawConfig.key_env) ??
      resolveHermesSecretInput(rawConfig.apiKeyEnv) ??
      resolveHermesSecretInput(rawConfig.api_key) ??
      resolveHermesSecretInput(rawConfig.apiKey);
    const modelEntries = [
      ...collectStringList(rawConfig.models),
      ...collectStringList(rawConfig.model),
      ...collectStringList(rawConfig.default_model),
      ...collectStringList(rawConfig.defaultModel),
    ];
    imports.push({
      providerId,
      baseUrl,
      ...(apiKey ? { apiKey } : {}),
      models: [...new Set(modelEntries)],
    });
  }
  return imports;
}

function mergeHermesProviders(
  config: GenesisConfig,
  imports: HermesProviderImport[],
  force: boolean,
): GenesisConfig {
  if (imports.length === 0) {
    return config;
  }
  const next = cloneConfig(config);
  next.models = { ...next.models };
  next.models.providers = { ...next.models.providers };
  for (const entry of imports) {
    const existing = next.models.providers[entry.providerId];
    if (existing && !force) {
      continue;
    }
    const existingModels = existing?.models ?? [];
    const modelIds = [...new Set([...existingModels.map((model) => model.id), ...entry.models])];
    const models =
      modelIds.length > 0
        ? modelIds.map((modelId) => {
            const existingModel = existingModels.find((model) => model.id === modelId);
            return existingModel ?? createImportedModelDefinition(modelId);
          })
        : [createImportedModelDefinition("default")];
    const providerConfig: ModelProviderConfig = {
      ...existing,
      baseUrl: entry.baseUrl,
      api: existing?.api ?? "openai-completions",
      ...(entry.apiKey ? { apiKey: entry.apiKey } : {}),
      models,
    };
    next.models.providers[entry.providerId] = providerConfig;
  }
  return next;
}

function mergeHermesAgentSettings(
  config: GenesisConfig,
  hermesConfig: unknown,
  targetStateDir: string,
  force: boolean,
): GenesisConfig {
  if (!isRecord(hermesConfig)) {
    return config;
  }
  const next = cloneConfig(config);
  next.agents = { ...next.agents };
  next.agents.defaults = { ...next.agents.defaults };
  const timezone = normalizeText(hermesConfig.timezone);
  if (timezone && (force || !next.agents.defaults.userTimezone)) {
    next.agents.defaults.userTimezone = timezone;
  }
  const terminal = isRecord(hermesConfig.terminal) ? hermesConfig.terminal : undefined;
  const cwd = normalizeText(terminal?.cwd);
  const workspace =
    cwd && cwd !== "." ? resolveUserPath(cwd) : path.join(targetStateDir, "workspace");
  if (workspace && (force || !next.agents.defaults.workspace)) {
    next.agents.defaults.workspace = workspace;
  }
  return next;
}

export function buildHermesGenesisConfig(params: {
  baseConfig: GenesisConfig;
  hermesConfig: unknown;
  targetStateDir: string;
  force?: boolean;
}): { config: GenesisConfig; warnings: string[]; providerImports: HermesProviderImport[] } {
  const force = params.force === true;
  const warnings: string[] = [];
  let next = cloneConfig(params.baseConfig);
  const primary = isRecord(params.hermesConfig)
    ? parseHermesModelRef(params.hermesConfig.model)
    : null;
  const fallbacks = isRecord(params.hermesConfig)
    ? normalizeHermesFallbackModels(params.hermesConfig.fallback_model)
    : [];
  if (isRecord(params.hermesConfig) && params.hermesConfig.model && !primary) {
    warnings.push("Hermes model setting was not provider-qualified; it was left unchanged.");
  }
  if (isRecord(params.hermesConfig) && Array.isArray(params.hermesConfig.fallback_providers)) {
    warnings.push(
      "Hermes fallback_providers are provider-only; configure Genesis model fallbacks explicitly if needed.",
    );
  }
  next = mergeAgentModelDefaults(next, primary, fallbacks, force);
  next = mergeHermesAgentSettings(next, params.hermesConfig, params.targetStateDir, force);
  const providerImports = collectHermesProviderImports(params.hermesConfig);
  next = mergeHermesProviders(next, providerImports, force);
  return { config: next, warnings, providerImports };
}

function normalizeAuthExpiresMs(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value > 9_999_999_999 ? Math.trunc(value) : Math.trunc(value * 1000);
  }
  const text = normalizeText(value);
  if (!text) {
    return undefined;
  }
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function buildHermesProfileId(provider: string, seed: string): string {
  const digest = crypto
    .createHash("sha256")
    .update(`${provider}\0${seed}`)
    .digest("hex")
    .slice(0, 8);
  return `${provider}:hermes-${sanitizeId(seed, "import")}-${digest}`;
}

function authEntryToProfile(
  provider: string,
  entry: Record<string, unknown>,
  source: string,
): AuthProfilePlanEntry | null {
  const normalizedProvider = normalizeHermesProvider(provider);
  const authType = normalizeText(entry.auth_type) ?? normalizeText(entry.type);
  const accessToken =
    normalizeText(entry.access_token) ??
    normalizeText(entry.api_key) ??
    normalizeText(entry.agent_key) ??
    normalizeText(entry.token);
  if (!normalizedProvider || !accessToken) {
    return null;
  }
  const label = normalizeText(entry.label) ?? source;
  if (authType === "oauth") {
    return {
      profileId: buildHermesProfileId(normalizedProvider, `${source}:oauth`),
      displayName: `Hermes ${label}`,
      credential: {
        type: "token",
        provider: normalizedProvider,
        token: accessToken,
        expires: normalizeAuthExpiresMs(entry.expires_at_ms ?? entry.expires_at),
        displayName: `Hermes ${label}`,
      },
    };
  }
  return {
    profileId: buildHermesProfileId(normalizedProvider, `${source}:api_key`),
    displayName: `Hermes ${label}`,
    credential: {
      type: "api_key",
      provider: normalizedProvider,
      key: accessToken,
      displayName: `Hermes ${label}`,
      metadata: { migratedFrom: "hermes", source },
    },
  };
}

export function collectHermesAuthProfiles(authStore: unknown): AuthProfilePlanEntry[] {
  if (!isRecord(authStore)) {
    return [];
  }
  const profiles: AuthProfilePlanEntry[] = [];
  const providers = isRecord(authStore.providers) ? authStore.providers : {};
  for (const [provider, state] of Object.entries(providers)) {
    if (!isRecord(state)) {
      continue;
    }
    const profile = authEntryToProfile(provider, state, `providers.${provider}`);
    if (profile) {
      profiles.push(profile);
    }
  }
  const pool = isRecord(authStore.credential_pool) ? authStore.credential_pool : {};
  for (const [provider, entries] of Object.entries(pool)) {
    if (!Array.isArray(entries)) {
      continue;
    }
    for (const [index, entry] of entries.entries()) {
      if (!isRecord(entry)) {
        continue;
      }
      const source = `credential_pool.${provider}.${normalizeText(entry.id) ?? String(index + 1)}`;
      const profile = authEntryToProfile(provider, entry, source);
      if (profile) {
        profiles.push(profile);
      }
    }
  }
  const byId = new Map<string, AuthProfilePlanEntry>();
  for (const profile of profiles) {
    byId.set(profile.profileId, profile);
  }
  return [...byId.values()].toSorted((left, right) =>
    left.profileId.localeCompare(right.profileId),
  );
}

function applyAuthProfilesToConfig(
  config: GenesisConfig,
  profiles: AuthProfilePlanEntry[],
  force: boolean,
): GenesisConfig {
  let next = cloneConfig(config);
  for (const profile of profiles) {
    if (!force && next.auth?.profiles?.[profile.profileId]) {
      continue;
    }
    next = applyAuthProfileConfig(next, {
      profileId: profile.profileId,
      provider: profile.credential.provider,
      mode: profile.credential.type === "token" ? "token" : "api_key",
      displayName: profile.displayName,
    });
  }
  return next;
}

async function loadHermesAuthProfiles(sourceDir: string): Promise<AuthProfilePlanEntry[]> {
  const authPath = path.join(sourceDir, "auth.json");
  if (!(await pathExists(authPath))) {
    return [];
  }
  const store = loadJsonFile(authPath);
  return collectHermesAuthProfiles(store);
}

async function buildHermesPlan(opts: MigrateCommandOptions): Promise<MigrationPlan> {
  const sourceDir = resolveHermesSourceDir(opts.sourceDir);
  const sourceConfigPath = resolveHermesConfigPath(sourceDir, opts.sourceConfig);
  if (!(await pathExists(sourceDir))) {
    throw new Error(`Hermes home directory not found: ${sourceDir}`);
  }
  if (!(await pathExists(sourceConfigPath))) {
    throw new Error(`Hermes config file not found: ${sourceConfigPath}`);
  }
  const targetStateDir = resolveStateDir();
  const targetConfigPath = resolveConfigPath(process.env, targetStateDir);
  const hermesConfig = await readConfigObject(sourceConfigPath, "yaml");
  const targetSnapshot = await readConfigFileSnapshot();
  const baseConfig = targetSnapshot.sourceConfig ?? {};
  const built = buildHermesGenesisConfig({
    baseConfig,
    hermesConfig,
    targetStateDir,
    force: opts.force,
  });
  const authProfiles = await loadHermesAuthProfiles(sourceDir);
  const nextConfig = applyAuthProfilesToConfig(built.config, authProfiles, opts.force === true);
  const changes: MigrationChange[] = [
    {
      action: "merge",
      target: targetConfigPath,
      detail: `Import Hermes model, provider, workspace, timezone, and auth-profile config from ${sourceConfigPath}.`,
    },
  ];
  if (authProfiles.length > 0) {
    changes.push({
      action: "write",
      target: resolveGenesisAgentDir(),
      detail: `Import ${authProfiles.length} Hermes auth profile(s) into the main Genesis agent.`,
    });
  }
  const warnings = [...built.warnings];
  if (built.providerImports.length > 0) {
    warnings.push(
      "Hermes custom provider metadata was imported with conservative zero-cost model defaults.",
    );
  }
  warnings.push(
    "Hermes sessions and memory stores are copied as archives when present; Genesis does not replay them as native sessions.",
  );

  const envMerge = await buildDotEnvMergePlan({
    sourcePath: path.join(sourceDir, ".env"),
    targetPath: path.join(targetStateDir, ".env"),
  });
  if (envMerge) {
    changes.push({
      action: "merge",
      target: envMerge.targetPath,
      detail: `Import ${Object.keys(envMerge.entries).length} Hermes environment variable(s).`,
    });
  }

  const copies: CopyPlanEntry[] = [];
  const workspace =
    nextConfig.agents?.defaults?.workspace &&
    typeof nextConfig.agents.defaults.workspace === "string"
      ? resolveUserPath(nextConfig.agents.defaults.workspace)
      : path.join(targetStateDir, "workspace");
  const soulCopy = await planCopy(
    changes,
    warnings,
    {
      sourcePath: path.join(sourceDir, "SOUL.md"),
      targetPath: path.join(workspace, "SOUL.md"),
      kind: "file",
      description: "Hermes SOUL.md",
    },
    opts.force === true,
  );
  if (soulCopy) {
    copies.push(soulCopy);
  }
  copies.push(
    ...(await collectDirectoryChildCopies({
      sourceDir: path.join(sourceDir, "skills"),
      targetDir: path.join(workspace, "skills"),
      description: "Hermes skill",
      changes,
      warnings,
      force: opts.force === true,
    })),
  );
  for (const archiveName of ["sessions", "memories", "cron", "plugins"] as const) {
    const planned = await planCopy(
      changes,
      warnings,
      {
        sourcePath: path.join(sourceDir, archiveName),
        targetPath: path.join(targetStateDir, "migrated", "hermes", archiveName),
        kind: "directory",
        description: `Hermes ${archiveName} archive`,
      },
      opts.force === true,
    );
    if (planned) {
      copies.push(planned);
    }
  }

  return {
    source: "hermes",
    dryRun: opts.dryRun === true,
    sourceDir,
    targetStateDir,
    targetConfigPath,
    changes,
    warnings,
    nextConfig,
    envMerge,
    copies,
    authProfiles,
  };
}

async function applyCopies(copies: CopyPlanEntry[], force: boolean): Promise<void> {
  for (const entry of copies) {
    await fs.mkdir(path.dirname(entry.targetPath), { recursive: true });
    if (entry.kind === "directory") {
      await fs.cp(entry.sourcePath, entry.targetPath, {
        recursive: true,
        force,
        errorOnExist: !force,
        verbatimSymlinks: true,
      });
    } else {
      await fs.copyFile(entry.sourcePath, entry.targetPath, force ? 0 : fsConstants.COPYFILE_EXCL);
    }
  }
}

async function applyDotEnvMerge(
  plan: DotEnvMergePlan | undefined,
  force: boolean,
): Promise<MigrationChange[]> {
  if (!plan) {
    return [];
  }
  const targetRaw = await fs.readFile(plan.targetPath, "utf8").catch(() => "");
  const merged = mergeDotEnvRaw({ targetRaw, entries: plan.entries, force });
  await fs.mkdir(path.dirname(plan.targetPath), { recursive: true });
  await fs.writeFile(plan.targetPath, merged.raw, { encoding: "utf8", mode: 0o600 });
  return [
    ...merged.added.map((key) => ({
      action: "write" as const,
      target: plan.targetPath,
      detail: `Added ${key}.`,
    })),
    ...merged.replaced.map((key) => ({
      action: "write" as const,
      target: plan.targetPath,
      detail: `Replaced ${key}.`,
    })),
    ...merged.skipped.map((key) => ({
      action: "skip" as const,
      target: plan.targetPath,
      detail: `${key} already exists; use --force to overwrite.`,
    })),
  ];
}

async function applyAuthProfiles(
  profiles: AuthProfilePlanEntry[],
  force: boolean,
): Promise<MigrationChange[]> {
  if (profiles.length === 0) {
    return [];
  }
  const store = ensureAuthProfileStoreForLocalUpdate(resolveGenesisAgentDir());
  const changes: MigrationChange[] = [];
  for (const profile of profiles) {
    if (store.profiles[profile.profileId] && !force) {
      changes.push({
        action: "skip",
        target: profile.profileId,
        detail: "Auth profile already exists; use --force to overwrite.",
      });
      continue;
    }
    store.profiles[profile.profileId] = profile.credential;
    changes.push({
      action: "write",
      target: profile.profileId,
      detail: `Imported ${profile.credential.provider} ${profile.credential.type} profile.`,
    });
  }
  saveAuthProfileStore(store, resolveGenesisAgentDir(), {
    filterExternalAuthProfiles: false,
    syncExternalCli: false,
  });
  return changes;
}

async function applyMigrationPlan(plan: MigrationPlan, force: boolean): Promise<MigrationResult> {
  if (!plan.nextConfig) {
    throw new Error("Migration plan did not produce config changes.");
  }
  await replaceConfigFile({
    nextConfig: plan.nextConfig,
    writeOptions: {
      skipOutputLogs: true,
    },
  });
  await applyCopies(plan.copies, force);
  const envChanges = await applyDotEnvMerge(plan.envMerge, force);
  const authChanges = await applyAuthProfiles(plan.authProfiles, force);
  return {
    source: plan.source,
    dryRun: plan.dryRun,
    sourceDir: plan.sourceDir,
    targetStateDir: plan.targetStateDir,
    targetConfigPath: plan.targetConfigPath,
    changes: [...plan.changes, ...envChanges, ...authChanges],
    warnings: plan.warnings,
  };
}

function formatMigrationSummary(result: MigrationResult): string[] {
  const lines = [
    `${result.dryRun ? "Migration plan" : "Migration complete"}: ${result.source}`,
    `Source: ${result.sourceDir}`,
    `Target state: ${result.targetStateDir}`,
    `Target config: ${result.targetConfigPath}`,
    "",
    "Changes:",
  ];
  if (result.changes.length === 0) {
    lines.push("  - No changes.");
  } else {
    for (const change of result.changes) {
      lines.push(`  - ${change.action}: ${change.detail}`);
    }
  }
  if (result.warnings.length > 0) {
    lines.push("", "Warnings:");
    for (const warning of result.warnings) {
      lines.push(`  - ${warning}`);
    }
  }
  if (result.dryRun) {
    lines.push("", "Run again without --dry-run to apply this plan.");
  }
  return lines;
}

async function buildMigrationPlan(
  source: MigrationSource,
  opts: MigrateCommandOptions,
): Promise<MigrationPlan> {
  if (source === "openclaw") {
    return await buildOpenClawPlan(opts);
  }
  return await buildHermesPlan(opts);
}

function normalizeMigrationSource(value: string): MigrationSource {
  const normalized = value.trim().toLowerCase();
  if (normalized === "openclaw" || normalized === "hermes") {
    return normalized;
  }
  throw new Error(`Unsupported migration source "${value}". Expected openclaw or hermes.`);
}

export async function migrateCommand(
  runtime: RuntimeEnv,
  sourceInput: string,
  opts: MigrateCommandOptions = {},
): Promise<MigrationResult> {
  const source = normalizeMigrationSource(sourceInput);
  const plan = await buildMigrationPlan(source, opts);
  const result = opts.dryRun === true ? plan : await applyMigrationPlan(plan, opts.force === true);
  if (opts.json) {
    writeRuntimeJson(runtime, result);
  } else {
    runtime.log(formatMigrationSummary(result).join("\n"));
  }
  return result;
}
