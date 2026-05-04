import os from "node:os";
import path from "node:path";
import { loadConfig, readConfigFileSnapshot, replaceConfigFile } from "../../config/config.js";
import { resolveStateDir } from "../../config/paths.js";
import type { GenesisConfig } from "../../config/types.genesis.js";
import type { PluginInstallRecord } from "../../config/types.plugins.js";
import {
  fetchClawHubPackageDetail,
  searchClawHubPackages,
  type ClawHubPackageFamily,
  type ClawHubPackageListItem,
  type ClawHubPackageSearchResult,
} from "../../infra/clawhub.js";
import { formatErrorMessage } from "../../infra/errors.js";
import {
  formatClawHubSpecifier,
  installPluginFromClawHub,
  type ClawHubPluginInstallRecordFields,
} from "../../plugins/clawhub.js";
import { enablePluginInConfig } from "../../plugins/enable.js";
import { recordPluginInstall } from "../../plugins/installs.js";
import { clearPluginManifestRegistryCache } from "../../plugins/manifest-registry.js";
import type { PluginDiagnostic } from "../../plugins/manifest-types.js";
import type { PluginRecord } from "../../plugins/registry.js";
import { applyExclusiveSlotSelection } from "../../plugins/slots.js";
import { buildPluginDiagnosticsReport, buildPluginSnapshotReport } from "../../plugins/status.js";
import { setPluginEnabledInConfig } from "../../plugins/toggle-config.js";
import { uninstallPlugin } from "../../plugins/uninstall.js";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  validatePluginsDetailParams,
  validatePluginsInstallParams,
  validatePluginsSearchParams,
  validatePluginsStatusParams,
  validatePluginsUninstallParams,
  validatePluginsUpdateParams,
} from "../protocol/index.js";
import type { GatewayRequestHandlers } from "./types.js";

type PluginInstallRecordForUi = Pick<
  PluginInstallRecord,
  | "source"
  | "spec"
  | "sourcePath"
  | "installPath"
  | "version"
  | "resolvedName"
  | "resolvedVersion"
  | "resolvedSpec"
  | "marketplaceName"
  | "marketplaceSource"
  | "marketplacePlugin"
  | "clawhubUrl"
  | "clawhubPackage"
  | "clawhubFamily"
  | "clawhubChannel"
  | "installedAt"
  | "resolvedAt"
>;

const INSTALLABLE_CLAWHUB_PLUGIN_FAMILIES = new Set<ClawHubPackageFamily>([
  "code-plugin",
  "bundle-plugin",
]);

const quietPluginLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

function isInstallableClawHubPluginPackage(
  entry: ClawHubPackageListItem,
): entry is ClawHubPackageListItem & { family: "code-plugin" | "bundle-plugin" } {
  return INSTALLABLE_CLAWHUB_PLUGIN_FAMILIES.has(entry.family);
}

function sortClawHubResults(results: ClawHubPackageSearchResult[]): ClawHubPackageSearchResult[] {
  return [...results].toSorted((a, b) => {
    const score = b.score - a.score;
    if (score !== 0) {
      return score;
    }
    return a.package.displayName.localeCompare(b.package.displayName);
  });
}

function sanitizeInstallRecord(
  install: PluginInstallRecord | undefined,
): PluginInstallRecordForUi | undefined {
  if (!install) {
    return undefined;
  }
  const result: PluginInstallRecordForUi = {
    source: install.source,
  };
  if (typeof install.spec === "string") {
    result.spec = install.spec;
  }
  if (typeof install.sourcePath === "string") {
    result.sourcePath = install.sourcePath;
  }
  if (typeof install.installPath === "string") {
    result.installPath = install.installPath;
  }
  if (typeof install.version === "string") {
    result.version = install.version;
  }
  if (typeof install.resolvedName === "string") {
    result.resolvedName = install.resolvedName;
  }
  if (typeof install.resolvedVersion === "string") {
    result.resolvedVersion = install.resolvedVersion;
  }
  if (typeof install.resolvedSpec === "string") {
    result.resolvedSpec = install.resolvedSpec;
  }
  if (typeof install.marketplaceName === "string") {
    result.marketplaceName = install.marketplaceName;
  }
  if (typeof install.marketplaceSource === "string") {
    result.marketplaceSource = install.marketplaceSource;
  }
  if (typeof install.marketplacePlugin === "string") {
    result.marketplacePlugin = install.marketplacePlugin;
  }
  if (typeof install.clawhubUrl === "string") {
    result.clawhubUrl = install.clawhubUrl;
  }
  if (typeof install.clawhubPackage === "string") {
    result.clawhubPackage = install.clawhubPackage;
  }
  if (typeof install.clawhubFamily === "string") {
    result.clawhubFamily = install.clawhubFamily;
  }
  if (typeof install.clawhubChannel === "string") {
    result.clawhubChannel = install.clawhubChannel;
  }
  if (typeof install.installedAt === "string") {
    result.installedAt = install.installedAt;
  }
  if (typeof install.resolvedAt === "string") {
    result.resolvedAt = install.resolvedAt;
  }
  return result;
}

function buildPluginStatusEntry(plugin: PluginRecord, install?: PluginInstallRecord) {
  return {
    id: plugin.id,
    name: plugin.name || plugin.id,
    status: plugin.status,
    source: plugin.source,
    origin: plugin.origin,
    enabled: plugin.enabled,
    ...(typeof plugin.explicitlyEnabled === "boolean"
      ? { explicitlyEnabled: plugin.explicitlyEnabled }
      : {}),
    ...(typeof plugin.imported === "boolean" ? { imported: plugin.imported } : {}),
    ...(plugin.description ? { description: plugin.description } : {}),
    ...(plugin.version ? { version: plugin.version } : {}),
    ...(plugin.format ? { format: plugin.format } : {}),
    ...(plugin.bundleFormat ? { bundleFormat: plugin.bundleFormat } : {}),
    ...(plugin.kind ? { kind: plugin.kind } : {}),
    ...(plugin.rootDir ? { rootDir: plugin.rootDir } : {}),
    ...(plugin.activationReason ? { activationReason: plugin.activationReason } : {}),
    ...(plugin.error ? { error: plugin.error } : {}),
    configSchema: plugin.configSchema,
    ...(install ? { install: sanitizeInstallRecord(install) } : {}),
    toolNames: [...plugin.toolNames],
    channelIds: [...plugin.channelIds],
    providerIds: [...plugin.providerIds],
    speechProviderIds: [...plugin.speechProviderIds],
    webSearchProviderIds: [...plugin.webSearchProviderIds],
    webFetchProviderIds: [...plugin.webFetchProviderIds],
    agentHarnessIds: [...plugin.agentHarnessIds],
    commands: [...plugin.commands],
    gatewayMethods: [...plugin.gatewayMethods],
    services: [...plugin.services],
    httpRoutes: plugin.httpRoutes,
  };
}

function sanitizeDiagnostic(entry: PluginDiagnostic) {
  return {
    level: entry.level,
    message: entry.message,
    ...(entry.pluginId ? { pluginId: entry.pluginId } : {}),
  };
}

function addInstalledPluginToAllowlist(cfg: GenesisConfig, pluginId: string): GenesisConfig {
  const allow = cfg.plugins?.allow;
  if (!Array.isArray(allow) || allow.length === 0 || allow.includes(pluginId)) {
    return cfg;
  }
  return {
    ...cfg,
    plugins: {
      ...cfg.plugins,
      allow: [...allow, pluginId].toSorted(),
    },
  };
}

function applySlotSelectionForPlugin(
  config: GenesisConfig,
  pluginId: string,
): { config: GenesisConfig; warnings: string[] } {
  const report = buildPluginDiagnosticsReport({ config, logger: quietPluginLogger });
  const plugin = report.plugins.find((entry) => entry.id === pluginId);
  if (!plugin) {
    return { config, warnings: [] };
  }
  const result = applyExclusiveSlotSelection({
    config,
    selectedId: plugin.id,
    selectedKind: plugin.kind,
    registry: report,
  });
  return { config: result.config, warnings: result.warnings };
}

async function readConfigForPluginWrite(): Promise<{ config: GenesisConfig; baseHash?: string }> {
  const snapshot = await readConfigFileSnapshot();
  const config = (snapshot.sourceConfig ?? snapshot.config) as GenesisConfig;
  return {
    config,
    ...(snapshot.hash !== undefined ? { baseHash: snapshot.hash } : {}),
  };
}

async function persistClawHubPluginInstall(params: {
  config: GenesisConfig;
  baseHash?: string;
  pluginId: string;
  install: Omit<PluginInstallRecord, "source"> & ClawHubPluginInstallRecordFields;
}): Promise<{ warnings: string[] }> {
  const warnings: string[] = [];
  const enableResult = enablePluginInConfig(
    addInstalledPluginToAllowlist(params.config, params.pluginId),
    params.pluginId,
  );
  let next = enableResult.config;
  if (!enableResult.enabled) {
    warnings.push(
      `Plugin was installed but not enabled: ${enableResult.reason ?? "unknown reason"}`,
    );
  }
  next = recordPluginInstall(next, {
    pluginId: params.pluginId,
    ...params.install,
  });
  const slotResult = applySlotSelectionForPlugin(next, params.pluginId);
  next = slotResult.config;
  warnings.push(...slotResult.warnings);
  await replaceConfigFile({
    nextConfig: next,
    ...(params.baseHash !== undefined ? { baseHash: params.baseHash } : {}),
  });
  return { warnings };
}

function resolveRemovedActionLabels(actions: Record<string, boolean>): string[] {
  const labels: Array<[string, string]> = [
    ["entry", "config entry"],
    ["install", "install record"],
    ["allowlist", "allowlist"],
    ["loadPath", "load path"],
    ["memorySlot", "memory slot"],
    ["channelConfig", "channel config"],
    ["directory", "directory"],
  ];
  return labels.filter(([key]) => actions[key]).map(([, label]) => label);
}

export const pluginsHandlers: GatewayRequestHandlers = {
  "plugins.status": ({ params, respond }) => {
    if (!validatePluginsStatusParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid plugins.status params: ${formatValidationErrors(validatePluginsStatusParams.errors)}`,
        ),
      );
      return;
    }
    try {
      const config = loadConfig();
      const report = buildPluginSnapshotReport({ config, logger: quietPluginLogger });
      const installs = config.plugins?.installs ?? {};
      respond(
        true,
        {
          ...(report.workspaceDir ? { workspaceDir: report.workspaceDir } : {}),
          plugins: report.plugins.map((plugin) =>
            buildPluginStatusEntry(plugin, installs[plugin.id]),
          ),
          diagnostics: report.diagnostics.map(sanitizeDiagnostic),
        },
        undefined,
      );
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatErrorMessage(err)));
    }
  },
  "plugins.search": async ({ params, respond }) => {
    if (!validatePluginsSearchParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid plugins.search params: ${formatValidationErrors(validatePluginsSearchParams.errors)}`,
        ),
      );
      return;
    }
    try {
      const p = params as { query: string; limit?: number };
      const results = await searchClawHubPackages({
        query: p.query,
        limit: p.limit ?? 30,
      });
      respond(
        true,
        {
          results: sortClawHubResults(results)
            .filter((entry) => isInstallableClawHubPluginPackage(entry.package))
            .slice(0, p.limit ?? 30),
        },
        undefined,
      );
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatErrorMessage(err)));
    }
  },
  "plugins.detail": async ({ params, respond }) => {
    if (!validatePluginsDetailParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid plugins.detail params: ${formatValidationErrors(validatePluginsDetailParams.errors)}`,
        ),
      );
      return;
    }
    try {
      const detail = await fetchClawHubPackageDetail({
        name: (params as { name: string }).name,
      });
      if (detail.package && !isInstallableClawHubPluginPackage(detail.package)) {
        respond(true, { package: null, owner: detail.owner ?? null }, undefined);
        return;
      }
      respond(true, detail, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatErrorMessage(err)));
    }
  },
  "plugins.install": async ({ params, respond }) => {
    if (!validatePluginsInstallParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid plugins.install params: ${formatValidationErrors(validatePluginsInstallParams.errors)}`,
        ),
      );
      return;
    }
    try {
      const p = params as {
        source: "clawhub";
        name: string;
        version?: string;
        force?: boolean;
        dangerouslyForceUnsafeInstall?: boolean;
      };
      const spec = formatClawHubSpecifier({ name: p.name, version: p.version });
      const result = await installPluginFromClawHub({
        spec,
        mode: p.force ? "update" : "install",
        dangerouslyForceUnsafeInstall: p.dangerouslyForceUnsafeInstall,
        logger: quietPluginLogger,
      });
      if (!result.ok) {
        respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, result.error));
        return;
      }
      const { config, baseHash } = await readConfigForPluginWrite();
      clearPluginManifestRegistryCache();
      const persisted = await persistClawHubPluginInstall({
        config,
        baseHash,
        pluginId: result.pluginId,
        install: {
          source: "clawhub",
          spec: formatClawHubSpecifier({
            name: result.clawhub.clawhubPackage,
            version: result.clawhub.version,
          }),
          installPath: result.targetDir,
          version: result.version,
          integrity: result.clawhub.integrity,
          resolvedAt: result.clawhub.resolvedAt,
          clawhubUrl: result.clawhub.clawhubUrl,
          clawhubPackage: result.clawhub.clawhubPackage,
          clawhubFamily: result.clawhub.clawhubFamily,
          clawhubChannel: result.clawhub.clawhubChannel,
        },
      });
      respond(
        true,
        {
          ok: true,
          message: `Installed plugin ${result.pluginId}`,
          pluginId: result.pluginId,
          ...(result.version ? { version: result.version } : {}),
          installPath: result.targetDir,
          warnings: persisted.warnings,
        },
        undefined,
      );
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatErrorMessage(err)));
    }
  },
  "plugins.update": async ({ params, respond }) => {
    if (!validatePluginsUpdateParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid plugins.update params: ${formatValidationErrors(validatePluginsUpdateParams.errors)}`,
        ),
      );
      return;
    }
    try {
      const p = params as { pluginId: string; enabled: boolean };
      const { config, baseHash } = await readConfigForPluginWrite();
      const report = buildPluginSnapshotReport({ config, logger: quietPluginLogger });
      const plugin = report.plugins.find(
        (entry) => entry.id === p.pluginId || entry.name === p.pluginId,
      );
      if (!plugin && !(p.pluginId in (config.plugins?.entries ?? {}))) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, `Plugin not found: ${p.pluginId}`),
        );
        return;
      }
      const pluginId = plugin?.id ?? p.pluginId;
      const warnings: string[] = [];
      let next: GenesisConfig;
      if (p.enabled) {
        const enableResult = enablePluginInConfig(config, pluginId);
        if (!enableResult.enabled) {
          respond(
            false,
            undefined,
            errorShape(
              ErrorCodes.INVALID_REQUEST,
              `Plugin "${pluginId}" could not be enabled (${enableResult.reason ?? "unknown reason"}).`,
            ),
          );
          return;
        }
        const slotResult = applySlotSelectionForPlugin(enableResult.config, pluginId);
        next = slotResult.config;
        warnings.push(...slotResult.warnings);
      } else {
        next = setPluginEnabledInConfig(config, pluginId, false);
      }
      await replaceConfigFile({
        nextConfig: next,
        ...(baseHash !== undefined ? { baseHash } : {}),
      });
      respond(
        true,
        {
          ok: true,
          pluginId,
          enabled: p.enabled,
          message: p.enabled ? `Enabled plugin ${pluginId}` : `Disabled plugin ${pluginId}`,
          warnings,
        },
        undefined,
      );
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatErrorMessage(err)));
    }
  },
  "plugins.uninstall": async ({ params, respond }) => {
    if (!validatePluginsUninstallParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid plugins.uninstall params: ${formatValidationErrors(validatePluginsUninstallParams.errors)}`,
        ),
      );
      return;
    }
    try {
      const p = params as { pluginId: string; keepFiles?: boolean };
      const { config, baseHash } = await readConfigForPluginWrite();
      const report = buildPluginDiagnosticsReport({ config, logger: quietPluginLogger });
      const plugin = report.plugins.find(
        (entry) => entry.id === p.pluginId || entry.name === p.pluginId,
      );
      const pluginId = plugin?.id ?? p.pluginId;
      const hasEntry = pluginId in (config.plugins?.entries ?? {});
      const hasInstall = pluginId in (config.plugins?.installs ?? {});
      if (!hasEntry && !hasInstall) {
        const message = plugin
          ? `Plugin "${pluginId}" is not managed by plugins config/install records and cannot be uninstalled. Disable it instead.`
          : `Plugin not found: ${p.pluginId}`;
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, message));
        return;
      }
      const channelIds = plugin?.status === "loaded" ? plugin.channelIds : undefined;
      const extensionsDir = path.join(resolveStateDir(process.env, os.homedir), "extensions");
      const result = await uninstallPlugin({
        config,
        pluginId,
        channelIds,
        deleteFiles: !p.keepFiles,
        extensionsDir,
      });
      if (!result.ok) {
        respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, result.error));
        return;
      }
      clearPluginManifestRegistryCache();
      await replaceConfigFile({
        nextConfig: result.config,
        ...(baseHash !== undefined ? { baseHash } : {}),
      });
      const removed = resolveRemovedActionLabels(result.actions);
      respond(
        true,
        {
          ok: true,
          pluginId,
          removed,
          warnings: result.warnings,
          message: `Uninstalled plugin ${pluginId}. Removed: ${removed.length > 0 ? removed.join(", ") : "nothing"}.`,
        },
        undefined,
      );
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatErrorMessage(err)));
    }
  },
};
