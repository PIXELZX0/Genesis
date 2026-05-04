import { Type, type Static } from "typebox";
import { NonEmptyString } from "./primitives.js";

const NullableStringSchema = Type.Union([Type.String(), Type.Null()]);

export const PluginPackageFamilySchema = Type.Union([
  Type.Literal("code-plugin"),
  Type.Literal("bundle-plugin"),
]);

export const PluginPackageChannelSchema = Type.Union([
  Type.Literal("official"),
  Type.Literal("community"),
  Type.Literal("private"),
]);

export const PluginInstallRecordSchema = Type.Object(
  {
    source: NonEmptyString,
    spec: Type.Optional(Type.String()),
    sourcePath: Type.Optional(Type.String()),
    installPath: Type.Optional(Type.String()),
    version: Type.Optional(Type.String()),
    resolvedName: Type.Optional(Type.String()),
    resolvedVersion: Type.Optional(Type.String()),
    resolvedSpec: Type.Optional(Type.String()),
    marketplaceName: Type.Optional(Type.String()),
    marketplaceSource: Type.Optional(Type.String()),
    marketplacePlugin: Type.Optional(Type.String()),
    clawhubUrl: Type.Optional(Type.String()),
    clawhubPackage: Type.Optional(Type.String()),
    clawhubFamily: Type.Optional(Type.String()),
    clawhubChannel: Type.Optional(Type.String()),
    installedAt: Type.Optional(Type.String()),
    resolvedAt: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const PluginStatusEntrySchema = Type.Object(
  {
    id: NonEmptyString,
    name: NonEmptyString,
    status: Type.Union([Type.Literal("loaded"), Type.Literal("disabled"), Type.Literal("error")]),
    source: Type.String(),
    origin: Type.String(),
    enabled: Type.Boolean(),
    explicitlyEnabled: Type.Optional(Type.Boolean()),
    imported: Type.Optional(Type.Boolean()),
    description: Type.Optional(Type.String()),
    version: Type.Optional(Type.String()),
    format: Type.Optional(Type.String()),
    bundleFormat: Type.Optional(Type.String()),
    kind: Type.Optional(Type.Union([Type.String(), Type.Array(Type.String())])),
    rootDir: Type.Optional(Type.String()),
    activationReason: Type.Optional(Type.String()),
    error: Type.Optional(Type.String()),
    configSchema: Type.Boolean(),
    install: Type.Optional(PluginInstallRecordSchema),
    toolNames: Type.Array(Type.String()),
    channelIds: Type.Array(Type.String()),
    providerIds: Type.Array(Type.String()),
    speechProviderIds: Type.Array(Type.String()),
    webSearchProviderIds: Type.Array(Type.String()),
    webFetchProviderIds: Type.Array(Type.String()),
    agentHarnessIds: Type.Array(Type.String()),
    commands: Type.Array(Type.String()),
    gatewayMethods: Type.Array(Type.String()),
    services: Type.Array(Type.String()),
    httpRoutes: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export const PluginsStatusParamsSchema = Type.Object({}, { additionalProperties: false });

export const PluginsStatusResultSchema = Type.Object(
  {
    workspaceDir: Type.Optional(Type.String()),
    plugins: Type.Array(PluginStatusEntrySchema),
    diagnostics: Type.Array(
      Type.Object(
        {
          level: Type.String(),
          message: Type.String(),
          pluginId: Type.Optional(Type.String()),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);

const ClawHubPackageListItemSchema = Type.Object(
  {
    name: NonEmptyString,
    displayName: NonEmptyString,
    family: PluginPackageFamilySchema,
    runtimeId: Type.Optional(Type.Union([NonEmptyString, Type.Null()])),
    channel: PluginPackageChannelSchema,
    isOfficial: Type.Boolean(),
    summary: Type.Optional(NullableStringSchema),
    ownerHandle: Type.Optional(NullableStringSchema),
    createdAt: Type.Integer(),
    updatedAt: Type.Integer(),
    latestVersion: Type.Optional(NullableStringSchema),
    capabilityTags: Type.Optional(Type.Array(Type.String())),
    executesCode: Type.Optional(Type.Boolean()),
    verificationTier: Type.Optional(NullableStringSchema),
  },
  { additionalProperties: false },
);

export const PluginsSearchParamsSchema = Type.Object(
  {
    query: NonEmptyString,
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  },
  { additionalProperties: false },
);

export const PluginsSearchResultSchema = Type.Object(
  {
    results: Type.Array(
      Type.Object(
        {
          score: Type.Number(),
          package: ClawHubPackageListItemSchema,
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);

export const PluginsDetailParamsSchema = Type.Object(
  {
    name: NonEmptyString,
  },
  { additionalProperties: false },
);

export const PluginsDetailResultSchema = Type.Object(
  {
    package: Type.Union([
      Type.Object(
        {
          name: NonEmptyString,
          displayName: NonEmptyString,
          family: PluginPackageFamilySchema,
          runtimeId: Type.Optional(Type.Union([NonEmptyString, Type.Null()])),
          channel: PluginPackageChannelSchema,
          isOfficial: Type.Boolean(),
          summary: Type.Optional(NullableStringSchema),
          ownerHandle: Type.Optional(NullableStringSchema),
          createdAt: Type.Integer(),
          updatedAt: Type.Integer(),
          latestVersion: Type.Optional(NullableStringSchema),
          capabilityTags: Type.Optional(Type.Array(Type.String())),
          executesCode: Type.Optional(Type.Boolean()),
          verificationTier: Type.Optional(NullableStringSchema),
          tags: Type.Optional(Type.Record(NonEmptyString, Type.String())),
          compatibility: Type.Optional(
            Type.Union([
              Type.Object(
                {
                  pluginApiRange: Type.Optional(Type.String()),
                  builtWithGenesisVersion: Type.Optional(Type.String()),
                  pluginSdkVersion: Type.Optional(Type.String()),
                  minGatewayVersion: Type.Optional(Type.String()),
                },
                { additionalProperties: false },
              ),
              Type.Null(),
            ]),
          ),
          capabilities: Type.Optional(
            Type.Union([
              Type.Object(
                {
                  executesCode: Type.Optional(Type.Boolean()),
                  runtimeId: Type.Optional(Type.String()),
                  capabilityTags: Type.Optional(Type.Array(Type.String())),
                  bundleFormat: Type.Optional(Type.String()),
                  hostTargets: Type.Optional(Type.Array(Type.String())),
                  pluginKind: Type.Optional(Type.String()),
                  channels: Type.Optional(Type.Array(Type.String())),
                  providers: Type.Optional(Type.Array(Type.String())),
                  hooks: Type.Optional(Type.Array(Type.String())),
                  bundledSkills: Type.Optional(Type.Array(Type.String())),
                },
                { additionalProperties: false },
              ),
              Type.Null(),
            ]),
          ),
          verification: Type.Optional(
            Type.Union([
              Type.Object(
                {
                  tier: Type.Optional(Type.String()),
                  scope: Type.Optional(Type.String()),
                  summary: Type.Optional(Type.String()),
                  sourceRepo: Type.Optional(Type.String()),
                  sourceCommit: Type.Optional(Type.String()),
                  hasProvenance: Type.Optional(Type.Boolean()),
                  scanStatus: Type.Optional(Type.String()),
                },
                { additionalProperties: false },
              ),
              Type.Null(),
            ]),
          ),
        },
        { additionalProperties: false },
      ),
      Type.Null(),
    ]),
    owner: Type.Optional(
      Type.Union([
        Type.Object(
          {
            handle: Type.Optional(NullableStringSchema),
            displayName: Type.Optional(NullableStringSchema),
            image: Type.Optional(NullableStringSchema),
          },
          { additionalProperties: false },
        ),
        Type.Null(),
      ]),
    ),
  },
  { additionalProperties: false },
);

export const PluginsInstallParamsSchema = Type.Object(
  {
    source: Type.Literal("clawhub"),
    name: NonEmptyString,
    version: Type.Optional(NonEmptyString),
    force: Type.Optional(Type.Boolean()),
    dangerouslyForceUnsafeInstall: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

export const PluginsInstallResultSchema = Type.Object(
  {
    ok: Type.Literal(true),
    message: NonEmptyString,
    pluginId: NonEmptyString,
    version: Type.Optional(Type.String()),
    installPath: Type.Optional(Type.String()),
    warnings: Type.Array(Type.String()),
  },
  { additionalProperties: false },
);

export const PluginsUpdateParamsSchema = Type.Object(
  {
    pluginId: NonEmptyString,
    enabled: Type.Boolean(),
  },
  { additionalProperties: false },
);

export const PluginsUpdateResultSchema = Type.Object(
  {
    ok: Type.Literal(true),
    pluginId: NonEmptyString,
    enabled: Type.Boolean(),
    message: NonEmptyString,
    warnings: Type.Array(Type.String()),
  },
  { additionalProperties: false },
);

export const PluginsUninstallParamsSchema = Type.Object(
  {
    pluginId: NonEmptyString,
    keepFiles: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

export const PluginsUninstallResultSchema = Type.Object(
  {
    ok: Type.Literal(true),
    pluginId: NonEmptyString,
    removed: Type.Array(Type.String()),
    warnings: Type.Array(Type.String()),
    message: NonEmptyString,
  },
  { additionalProperties: false },
);

export type PluginsStatusParams = Static<typeof PluginsStatusParamsSchema>;
export type PluginsStatusResult = Static<typeof PluginsStatusResultSchema>;
export type PluginsSearchParams = Static<typeof PluginsSearchParamsSchema>;
export type PluginsSearchResult = Static<typeof PluginsSearchResultSchema>;
export type PluginsDetailParams = Static<typeof PluginsDetailParamsSchema>;
export type PluginsDetailResult = Static<typeof PluginsDetailResultSchema>;
export type PluginsInstallParams = Static<typeof PluginsInstallParamsSchema>;
export type PluginsInstallResult = Static<typeof PluginsInstallResultSchema>;
export type PluginsUpdateParams = Static<typeof PluginsUpdateParamsSchema>;
export type PluginsUpdateResult = Static<typeof PluginsUpdateResultSchema>;
export type PluginsUninstallParams = Static<typeof PluginsUninstallParamsSchema>;
export type PluginsUninstallResult = Static<typeof PluginsUninstallResultSchema>;
